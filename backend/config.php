<?php
declare(strict_types=1);

function env_value(string $name, string $default = ''): string
{
    $value = getenv($name);
    return $value === false ? $default : trim($value);
}

return [
    'db_host' => env_value('DB_HOST', '127.0.0.1'),
    'db_port' => env_value('DB_PORT', '3306'),
    'db_name' => env_value('DB_NAME', 'contract_verifier'),
    'db_user' => env_value('DB_USER', 'root'),
    'db_password' => env_value('DB_PASSWORD', 'root'),
    'solc_binary' => env_value('SOLC_BINARY', 'solc'),
    'solc_binaries_json' => env_value('SOLC_BINARIES', ''),
    'allowed_origins' => array_values(array_filter(array_map('trim', explode(',', env_value('ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174'))))),
    'allowed_rpc_hosts' => array_values(array_filter(array_map('strtolower', array_map('trim', explode(',', env_value('ALLOWED_RPC_HOSTS', 'localhost,127.0.0.1,::1')))))),
    'max_request_bytes' => 1_500_000,
    'compile_timeout_seconds' => 30,
];