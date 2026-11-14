# Execute locally. The key is read with hidden input and never passed in argv.
[CmdletBinding()]
param(
    [ValidatePattern('^acct_[a-zA-Z0-9]+$')]
    [string]$AccountId = 'acct_1Ub1arEtZs5VZmDQ',
    [string]$ProfilePath = (Join-Path (Split-Path -Parent $PSScriptRoot) '.aiox/supabase-arcadehub-profile.yaml')
)
$ErrorActionPreference = 'Stop'
$projectRef = 'zdwgwpvlwqtsdgervcof'
$repoRoot = Split-Path -Parent $PSScriptRoot
$previousCliHome = [Environment]::GetEnvironmentVariable('SUPABASE_HOME', 'Process')
$secure = $null
$bstr = [IntPtr]::Zero
$plain = $null
$tempDirectory = $null
$tempFile = $null
if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) { throw 'Perfil Supabase local ausente.' }
if ($AccountId -eq 'acct_1Te0GtHMBfCrtXpm') { throw 'Use a conta ClickDrop. A holding permanece na integracao atual.' }

Write-Host 'Conectar Stripe ClickDrop ao Arcade Hub - manter a conta holding.'
Write-Host ('Conta esperada: ' + $AccountId)
Write-Host 'No Stripe ClickDrop, crie uma chave restrita de PRODUCAO, somente leitura.'
Write-Host 'Permissoes: conta, saldo, cobrancas e transacoes de saldo (para taxas/liquido).'
Write-Host 'A chave sera validada na API e salva apenas como STRIPE_CLICKDROP_SECRET_KEY no Supabase.'
Write-Host 'Nao cole a chave no chat. A entrada abaixo e oculta.'
try {
    $secure = Read-Host 'Cole a chave rk_live_ do ClickDrop e pressione Enter' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    if ($plain -notmatch '^rk_live_[a-zA-Z0-9]+$') { throw 'Informe uma chave restrita de producao (rk_live_). Nenhuma alteracao foi enviada.' }
    $headers = @{ Authorization = 'Bearer ' + $plain }
    try {
        $account = Invoke-RestMethod -Uri 'https://api.stripe.com/v1/account' -Headers $headers -TimeoutSec 20
    } catch { throw 'A chave nao pode consultar a conta. Confira a permissao de leitura da conta.' }
    if ($account.id -ne $AccountId) { throw 'A chave pertence a outra conta Stripe. Nenhum segredo foi alterado.' }
    try {
        $balance = Invoke-RestMethod -Uri 'https://api.stripe.com/v1/balance' -Headers $headers -TimeoutSec 20
        $charges = Invoke-RestMethod -Uri 'https://api.stripe.com/v1/charges?limit=1&expand%5B%5D=data.balance_transaction' -Headers $headers -TimeoutSec 20
    } catch { throw 'Falta permissao para consultar saldo, cobrancas ou transacoes de saldo. Nenhum segredo foi alterado.' }
    if ($balance.livemode -ne $true -or @($charges.data | Where-Object { $_.livemode -ne $true }).Count -gt 0) { throw 'A conta retornou dados de teste. Nenhum segredo foi alterado.' }

    # Restrict the directory before writing the ephemeral env file.
    $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('arcadehub-stripe-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $tempDirectory
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($identity)
    $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')))
    Set-Acl -LiteralPath $tempDirectory -AclObject $acl
    $tempFile = Join-Path $tempDirectory 'stripe.env'
    [IO.File]::WriteAllText($tempFile, ('STRIPE_CLICKDROP_SECRET_KEY=' + $plain + "`nSTRIPE_CLICKDROP_ACCOUNT_ID=" + $AccountId + "`n"), (New-Object Text.UTF8Encoding($false)))
    [Environment]::SetEnvironmentVariable('SUPABASE_HOME', (Join-Path $repoRoot '.aiox/supabase-cli-home'), 'Process')
    $ErrorActionPreference = 'Continue'
    $cliOutput = & npx.cmd --yes supabase@2.121.0 secrets set --env-file $tempFile --project-ref $projectRef --profile $ProfilePath 2>&1
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'Nao foi possivel salvar os segredos no Supabase. Confira o perfil e tente novamente.' }
    # Status contains no credential or customer information.
    $statusPath = Join-Path $repoRoot '.aiox/stripe-clickdrop-setup.json'
    @{ ok = $true; account_id = $AccountId; verified_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-Host 'Conta ClickDrop validada e chave salva no Supabase. A chave da holding foi preservada.' -ForegroundColor Green
} finally {
    [Environment]::SetEnvironmentVariable('SUPABASE_HOME', $previousCliHome, 'Process')
    if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($null -ne $secure) { $secure.Dispose() }
    $plain = $null
    $headers = $null
    $cliOutput = $null
    if ($tempFile -and (Test-Path -LiteralPath $tempFile)) { Remove-Item -LiteralPath $tempFile -Force }
    if ($tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) { Remove-Item -LiteralPath $tempDirectory -Force }
}
