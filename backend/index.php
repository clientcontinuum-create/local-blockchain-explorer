<?php
declare(strict_types=1);

$config = require __DIR__ . '/config.php';

function respond(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function read_json_body(int $maxBytes): array
{
    $length = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > $maxBytes) {
        respond(413, ['error' => 'Request is too large.']);
    }

    $body = file_get_contents('php://input', false, null, 0, $maxBytes + 1);
    if ($body === false || strlen($body) > $maxBytes) {
        respond(413, ['error' => 'Request is too large.']);
    }

    $data = json_decode($body, true);
    if (!is_array($data)) {
        respond(400, ['error' => 'Request body must be a JSON object.']);
    }

    return $data;
}

function database(array $config): PDO
{
    foreach (['db_name', 'db_user'] as $required) {
        if ($config[$required] === '') {
            throw new RuntimeException('Database configuration is incomplete.');
        }
    }

    $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $config['db_host'], $config['db_port'], $config['db_name']);
    return new PDO($dsn, $config['db_user'], $config['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

function validate_address(mixed $value): string
{
    if (!is_string($value) || !preg_match('/^0x[a-fA-F0-9]{40}$/', $value)) {
        respond(400, ['error' => 'A valid EVM contract address is required.']);
    }
    return strtolower($value);
}

function rpc_call(string $url, string $method, array $params, array $config): mixed
{
    $parts = parse_url($url);
    $host = strtolower((string) ($parts['host'] ?? ''));
    $scheme = strtolower((string) ($parts['scheme'] ?? ''));
    if (!in_array($scheme, ['http', 'https'], true) || $host === '' || isset($parts['user']) || isset($parts['pass'])) {
        respond(400, ['error' => 'RPC URL must be an HTTP(S) URL without embedded credentials.']);
    }

    if (!in_array($host, $config['allowed_rpc_hosts'], true)) {
        respond(403, ['error' => 'This RPC host is not allowed by the backend. Add it to ALLOWED_RPC_HOSTS.']);
    }

    $curl = curl_init($url);
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => $method, 'params' => $params]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $response = curl_exec($curl);
    $curlError = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    curl_close($curl);

    if ($response === false || $status < 200 || $status >= 300) {
        error_log('RPC request failed: ' . $curlError . ' HTTP ' . $status);
        respond(502, ['error' => 'Could not read contract data from the configured RPC.']);
    }

    $decoded = json_decode($response, true);
    if (!is_array($decoded) || isset($decoded['error']) || !array_key_exists('result', $decoded)) {
        respond(502, ['error' => 'The RPC returned an invalid response.']);
    }

    return $decoded['result'];
}

function read_deployment(string $rpcUrl, string $address, array $config): array
{
    $chainId = rpc_call($rpcUrl, 'eth_chainId', [], $config);
    $code = rpc_call($rpcUrl, 'eth_getCode', [$address, 'latest'], $config);
    if (!is_string($chainId) || !preg_match('/^0x[0-9a-fA-F]+$/', $chainId) || !is_string($code) || !preg_match('/^0x(?:[0-9a-fA-F]{2})+$/', $code)) {
        respond(404, ['error' => 'No deployed contract bytecode was found at that address.']);
    }

    $chainId = '0x' . ltrim(strtolower(substr($chainId, 2)), '0');
    if ($chainId === '0x') {
        $chainId = '0x0';
    }

    return [$chainId, strtolower($code), hash('sha256', hex2bin(substr($code, 2)))];
}

function validate_sources(mixed $sources): array
{
    if (!is_array($sources) || count($sources) < 1 || count($sources) > 40) {
        respond(400, ['error' => 'Submit between 1 and 40 Solidity source files.']);
    }

    $validated = [];
    $totalBytes = 0;
    foreach ($sources as $path => $source) {
        if (!is_string($path) || $path === '' || str_contains($path, '\\') || str_starts_with($path, '/') || preg_match('#(^|/)\.\.(/|$)#', $path) || !str_ends_with(strtolower($path), '.sol') || !is_string($source)) {
            respond(400, ['error' => 'Source paths must be relative .sol file paths with no parent-directory segments.']);
        }
        $totalBytes += strlen($source);
        $validated[$path] = ['content' => $source];
    }

    if ($totalBytes > 1_000_000) {
        respond(413, ['error' => 'Total Solidity source size must not exceed 1 MB.']);
    }

    return $validated;
}

function compiler_version(string $binary): string
{
    $process = proc_open([$binary, '--version'], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, __DIR__);
    if (!is_resource($process)) {
        respond(503, ['error' => 'Solidity compiler is unavailable on the backend.']);
    }
    $output = stream_get_contents($pipes[1]);
    $error = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);
    if ($exitCode !== 0 || !preg_match('/Version:\s*(\d+\.\d+\.\d+)/', (string) $output, $matches)) {
        error_log('Could not read solc version: ' . $error);
        respond(503, ['error' => 'Could not determine the backend Solidity compiler version.']);
    }
    return $matches[1];
}

function compiler_registry(array $config): array
{
    $configured = [];
    if ($config['solc_binaries_json'] !== '') {
        $configured = json_decode($config['solc_binaries_json'], true);
        if (!is_array($configured) || count($configured) > 30) {
            respond(500, ['error' => 'SOLC_BINARIES must be a JSON object mapping compiler versions to executable paths.']);
        }
    }

    $binaries = [];
    foreach ($configured as $version => $binary) {
        if (!is_string($version) || !preg_match('/^\d+\.\d+\.\d+$/', $version) || !is_string($binary) || trim($binary) === '') {
            respond(500, ['error' => 'Each SOLC_BINARIES entry must map a semantic version to a compiler executable path.']);
        }
        $actualVersion = compiler_version($binary);
        if ($actualVersion !== $version) {
            respond(500, ['error' => 'Configured solc binary for ' . $version . ' reports version ' . $actualVersion . '.']);
        }
        $binaries[$version] = $binary;
    }

    $defaultVersion = compiler_version($config['solc_binary']);
    $binaries[$defaultVersion] ??= $config['solc_binary'];
    uksort($binaries, 'version_compare');
    return $binaries;
}

function compile_contract(array $input, string $compilerVersion, string $compilerBinary, array $config): array
{
    if (($input['compilerVersion'] ?? null) !== $compilerVersion) {
        respond(422, ['error' => 'Requested compiler version does not match the backend compiler (' . $compilerVersion . ').']);
    }

    $sources = validate_sources($input['sources'] ?? null);
    $file = $input['contractFile'] ?? null;
    $name = $input['contractName'] ?? null;
    if (!is_string($file) || !isset($sources[$file]) || !is_string($name) || !preg_match('/^[A-Za-z_$][A-Za-z0-9_$]*$/', $name)) {
        respond(400, ['error' => 'Choose a contract file and contract name from the submitted source.']);
    }

    $optimizer = $input['optimizer'] ?? [];
    $optimizerEnabled = is_array($optimizer) && ($optimizer['enabled'] ?? false) === true;
    $optimizerRuns = is_array($optimizer) ? (int) ($optimizer['runs'] ?? 200) : 200;
    if ($optimizerRuns < 1 || $optimizerRuns > 1_000_000) {
        respond(400, ['error' => 'Optimizer runs must be between 1 and 1000000.']);
    }

    $settings = [
        'optimizer' => ['enabled' => $optimizerEnabled, 'runs' => $optimizerRuns],
        'outputSelection' => ['*' => ['*' => ['abi', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'evm.deployedBytecode.linkReferences']]],
    ];
    if (isset($input['viaIR'])) {
        $settings['viaIR'] = $input['viaIR'] === true;
    }
    if (isset($input['evmVersion']) && $input['evmVersion'] !== '') {
        if (!is_string($input['evmVersion']) || !preg_match('/^[a-z0-9]+$/', $input['evmVersion'])) {
            respond(400, ['error' => 'Invalid EVM version.']);
        }
        $settings['evmVersion'] = $input['evmVersion'];
    }
    if (isset($input['metadataBytecodeHash'])) {
        if (!in_array($input['metadataBytecodeHash'], ['ipfs', 'bzzr1', 'none'], true)) {
            respond(400, ['error' => 'Metadata bytecode hash must be ipfs, bzzr1, or none.']);
        }
        $settings['metadata'] = ['bytecodeHash' => $input['metadataBytecodeHash']];
    }

    $standardInput = json_encode(['language' => 'Solidity', 'sources' => $sources, 'settings' => $settings], JSON_UNESCAPED_SLASHES);
    $stdoutPath = tempnam(__DIR__, '.solc-out-');
    $stderrPath = tempnam(__DIR__, '.solc-err-');
    if ($stdoutPath === false || $stderrPath === false) {
        if (is_string($stdoutPath)) {
            @unlink($stdoutPath);
        }
        if (is_string($stderrPath)) {
            @unlink($stderrPath);
        }
        respond(500, ['error' => 'Could not prepare the compiler workspace.']);
    }

    $compileError = null;
    $compileErrorStatus = 422;
    $output = null;
    try {
        $process = proc_open([$compilerBinary, '--standard-json'], [0 => ['pipe', 'r'], 1 => ['file', $stdoutPath, 'w'], 2 => ['file', $stderrPath, 'w']], $pipes, __DIR__);
        if (!is_resource($process)) {
            $compileError = 'Could not start the Solidity compiler.';
            $compileErrorStatus = 503;
        } else {
            fwrite($pipes[0], $standardInput);
            fclose($pipes[0]);
            $started = microtime(true);
            $processExitCode = -1;
            $timedOut = false;
            do {
                $status = proc_get_status($process);
                if (!$status['running']) {
                    $processExitCode = (int) $status['exitcode'];
                    break;
                }
                if (microtime(true) - $started > $config['compile_timeout_seconds']) {
                    proc_terminate($process, 9);
                    $timedOut = true;
                    break;
                }
                usleep(20_000);
            } while (true);
            $closeExitCode = proc_close($process);
            if ($timedOut) {
                $compileError = 'Compilation exceeded the backend time limit.';
                $compileErrorStatus = 408;
            } else {
                $exitCode = $processExitCode >= 0 ? $processExitCode : $closeExitCode;
                $compilerOutput = file_get_contents($stdoutPath);
                if ($exitCode !== 0 || $compilerOutput === false) {
                    error_log('solc failed: ' . (string) file_get_contents($stderrPath));
                    $compileError = 'Solidity compilation failed. Check the source files and compiler settings.';
                } else {
                    $output = json_decode($compilerOutput, true);
                    if (!is_array($output)) {
                        $compileError = 'The compiler returned invalid output.';
                    }
                }
            }
        }
    } finally {
        @unlink($stdoutPath);
        @unlink($stderrPath);
    }
    if ($compileError !== null) {
        respond($compileErrorStatus, ['error' => $compileError]);
    }

    $errors = array_values(array_filter($output['errors'] ?? [], static fn(array $item): bool => ($item['severity'] ?? '') === 'error'));
    if ($errors !== []) {
        $messages = array_map(static fn(array $item): string => (string) ($item['formattedMessage'] ?? $item['message'] ?? 'Compilation error'), array_slice($errors, 0, 5));
        respond(422, ['error' => implode("\n", $messages)]);
    }

    $contract = $output['contracts'][$file][$name] ?? null;
    $runtime = $contract['evm']['deployedBytecode']['object'] ?? '';
    if (!is_string($runtime) || $runtime === '') {
        respond(422, ['error' => 'The selected contract has no deployable runtime bytecode.']);
    }
    if (!empty($contract['evm']['deployedBytecode']['linkReferences'])) {
        respond(422, ['error' => 'Contracts with external library links are not supported by this verifier yet.']);
    }

    return [
        'name' => $name,
        'file' => $file,
        'runtime' => strtolower($runtime),
        'immutableReferences' => $contract['evm']['deployedBytecode']['immutableReferences'] ?? [],
        'abi' => $contract['abi'] ?? [],
        'sources' => array_map(static fn(array $source): string => $source['content'], $sources),
        'settings' => $settings,
    ];
}

function bytecode_matches(string $compiled, string $deployed, array $immutableReferences): bool
{
    if (!preg_match('/^[0-9a-f]+$/', $compiled) || strlen($compiled) !== strlen($deployed)) {
        return false;
    }

    $mask = array_fill(0, intdiv(strlen($compiled), 2), false);
    foreach ($immutableReferences as $references) {
        foreach ($references as $reference) {
            $offset = (int) ($reference['start'] ?? -1);
            $length = (int) ($reference['length'] ?? 0);
            if ($offset < 0 || $length < 1 || $offset + $length > count($mask)) {
                return false;
            }
            for ($index = $offset; $index < $offset + $length; $index++) {
                $mask[$index] = true;
            }
        }
    }

    for ($index = 0, $size = count($mask); $index < $size; $index++) {
        if (!$mask[$index] && substr($compiled, $index * 2, 2) !== substr($deployed, $index * 2, 2)) {
            return false;
        }
    }
    return true;
}

function strip_solidity_metadata(string $bytecode): string
{
    if (strlen($bytecode) < 8 || strlen($bytecode) % 2 !== 0 || !preg_match('/^[0-9a-f]+$/', $bytecode)) {
        return $bytecode;
    }

    $byteLength = intdiv(strlen($bytecode), 2);
    $metadataLength = hexdec(substr($bytecode, -4));
    $metadataStart = $byteLength - $metadataLength - 2;
    if ($metadataLength < 4 || $metadataStart < 0) {
        return $bytecode;
    }

    $metadata = substr($bytecode, $metadataStart * 2, $metadataLength * 2);
    if (!preg_match('/^(?:a1|a2|a3)(?:64(?:69706673|736f6c63)|65(?:627a7a7231))/', $metadata)) {
        return $bytecode;
    }

    return substr($bytecode, 0, $metadataStart * 2);
}

function set_cors(array $config): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        if (!in_array('*', $config['allowed_origins'], true) && !in_array($origin, $config['allowed_origins'], true)) {
            respond(403, ['error' => 'This browser origin is not allowed by the backend.']);
        }
        header('Access-Control-Allow-Origin: ' . (in_array('*', $config['allowed_origins'], true) ? '*' : $origin));
        header('Vary: Origin');
    }
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
}

set_cors($config);
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$action = $_GET['action'] ?? basename(rtrim($path, '/'));
if (str_ends_with($path, '/index.php') || $action === 'backend') {
    $action = $_GET['action'] ?? '';
}

try {
    if ($action === 'versions' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $binaries = compiler_registry($config);
        $versions = array_keys($binaries);
        $defaultVersion = compiler_version($config['solc_binary']);
        respond(200, ['versions' => $versions, 'defaultVersion' => $defaultVersion]);
    }

    if ($action === 'verify' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
        $input = read_json_body($config['max_request_bytes']);
        $address = validate_address($input['address'] ?? null);
        $rpcUrl = $input['rpcUrl'] ?? null;
        if (!is_string($rpcUrl) || strlen($rpcUrl) > 2048) {
            respond(400, ['error' => 'A valid RPC URL is required.']);
        }
        [$chainId, $deployedCode, $deployedHash] = read_deployment($rpcUrl, $address, $config);
        $binaries = compiler_registry($config);
        $compilerVersion = $input['compilerVersion'] ?? null;
        if (!is_string($compilerVersion) || !isset($binaries[$compilerVersion])) {
            respond(422, ['error' => 'Selected Solidity compiler version is not installed or configured on this backend.']);
        }
        $compiled = compile_contract($input, $compilerVersion, $binaries[$compilerVersion], $config);
        if (!bytecode_matches($compiled['runtime'], substr($deployedCode, 2), $compiled['immutableReferences'])) {
            $compiledExecutable = strip_solidity_metadata($compiled['runtime']);
            $deployedExecutable = strip_solidity_metadata(substr($deployedCode, 2));
            $message = $compiledExecutable === $deployedExecutable
                ? 'Executable bytecode matches, but Solidity metadata differs. Check the original source file path, exact source files, compiler version, EVM target, optimizer, viaIR, and metadata hash settings.'
                : 'The compiled executable bytecode does not match the contract deployed at this address. Check that the source and compiler settings belong to this exact deployment.';
            respond(422, ['error' => $message]);
        }

        $pdo = database($config);
        $statement = $pdo->prepare('INSERT INTO verified_contracts (chain_id, contract_address, deployed_code_hash, contract_name, source_files, compiler_version, compiler_settings, abi) VALUES (:chain, :address, :code_hash, :name, :sources, :version, :settings, :abi) ON DUPLICATE KEY UPDATE contract_name = VALUES(contract_name), source_files = VALUES(source_files), compiler_version = VALUES(compiler_version), compiler_settings = VALUES(compiler_settings), abi = VALUES(abi), created_at = CURRENT_TIMESTAMP');
        $statement->execute([
            ':chain' => $chainId,
            ':address' => $address,
            ':code_hash' => $deployedHash,
            ':name' => $compiled['name'],
            ':sources' => json_encode($compiled['sources'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            ':version' => $input['compilerVersion'],
            ':settings' => json_encode($compiled['settings'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
            ':abi' => json_encode($compiled['abi'], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR),
        ]);
        respond(201, ['verified' => true, 'chainId' => $chainId, 'address' => $address, 'bytecodeHash' => $deployedHash, 'contractName' => $compiled['name']]);
    }

    if ($action === 'contract' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
        $address = validate_address($_GET['address'] ?? null);
        $rpcUrl = $_GET['rpcUrl'] ?? null;
        if (!is_string($rpcUrl) || strlen($rpcUrl) > 2048) {
            respond(400, ['error' => 'A valid rpcUrl query parameter is required.']);
        }
        [$chainId, , $deployedHash] = read_deployment($rpcUrl, $address, $config);
        $statement = database($config)->prepare('SELECT contract_name, source_files, compiler_version, compiler_settings, abi, created_at FROM verified_contracts WHERE chain_id = :chain AND contract_address = :address AND deployed_code_hash = :code_hash LIMIT 1');
        $statement->execute([':chain' => $chainId, ':address' => $address, ':code_hash' => $deployedHash]);
        $contract = $statement->fetch();
        if (!$contract) {
            respond(404, ['verified' => false, 'error' => 'No matching verified source was found for this deployment.']);
        }
        respond(200, [
            'verified' => true,
            'chainId' => $chainId,
            'address' => $address,
            'bytecodeHash' => $deployedHash,
            'contractName' => $contract['contract_name'],
            'sources' => json_decode($contract['source_files'], true),
            'compilerVersion' => $contract['compiler_version'],
            'compilerSettings' => json_decode($contract['compiler_settings'], true),
            'abi' => json_decode($contract['abi'], true),
            'verifiedAt' => $contract['created_at'],
        ]);
    }

    respond(404, ['error' => 'Unknown endpoint. Use POST /verify or GET /contract.']);
} catch (Throwable $error) {
    error_log('Contract verifier error: ' . $error->getMessage());
    respond(500, ['error' => 'Backend configuration or database error. Check the PHP server log.']);
}