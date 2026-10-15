# Cadastro local de senha: nao imprime nem envia credenciais para o chat.
# Execute em um terminal seu, com o perfil Supabase autorizado para este projeto.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('cbai_solutions', 'jogadaca', 'coben', 'privabr', 'liquida_pecas', 'conferecheck')]
    [string]$Mailbox,

    [string]$ProfilePath = (Join-Path (Split-Path -Parent $PSScriptRoot) '.aiox/supabase-arcadehub-profile.yaml')
)

$ErrorActionPreference = 'Stop'
$projectRef = 'zdwgwpvlwqtsdgervcof'
$repoRoot = Split-Path -Parent $PSScriptRoot
$cliHomePath = Join-Path $repoRoot '.aiox/supabase-cli-home'
$secretName = 'MAILBOX_' + $Mailbox.ToUpperInvariant() + '_PASS_B64'
$addresses = @{
    cbai_solutions = 'suporte@cbaisolutions.com.br'
    jogadaca = 'contato@jogadaca.ai'
    coben = 'contato@coben.app'
    privabr = 'suporte@privabr.com.br'
    liquida_pecas = 'contato@liquidapecas.com.br'
    conferecheck = 'contato@conferecheck.com.br'
}

if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) {
    throw 'Perfil Supabase local ausente. Configure o acesso ao projeto antes de cadastrar a senha.'
}

$passwordSecure = $null
$passwordBstr = [IntPtr]::Zero
$passwordBytes = $null
$passwordPlain = $null
$passwordBase64 = $null
$tempDirectory = $null
$tempFile = $null
$previousCliHome = [Environment]::GetEnvironmentVariable('SUPABASE_HOME', 'Process')

try {
    $passwordSecure = Read-Host ('Senha Hostinger de ' + $addresses[$Mailbox]) -AsSecureString
    if ($null -eq $passwordSecure -or $passwordSecure.Length -eq 0) {
        throw 'Senha vazia: nenhuma alteracao foi enviada.'
    }

    # Restrinja a pasta ANTES de escrever qualquer conteudo sensivel.
    $tempDirectory = Join-Path ([IO.Path]::GetTempPath()) ('arcadehub-mailbox-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $tempDirectory
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $directoryAcl = New-Object Security.AccessControl.DirectorySecurity
    $directoryAcl.SetAccessRuleProtection($true, $false)
    $directoryAcl.SetOwner($identity)
    $accessRule = New-Object Security.AccessControl.FileSystemAccessRule(
        $identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'
    )
    $directoryAcl.AddAccessRule($accessRule)
    Set-Acl -LiteralPath $tempDirectory -AclObject $directoryAcl

    $passwordBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
    $passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordBstr)
    if ($passwordPlain -match '[\x00\r\n]') {
        throw 'A senha nao pode conter quebra de linha ou caractere NUL. Nenhuma alteracao foi enviada.'
    }
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($passwordPlain)
    $passwordBase64 = [Convert]::ToBase64String($passwordBytes)
    $tempFile = Join-Path $tempDirectory 'mailbox.env'
    [IO.File]::WriteAllText(
        $tempFile,
        $secretName + '=' + $passwordBase64 + [Environment]::NewLine,
        (New-Object Text.UTF8Encoding($false))
    )

    [Environment]::SetEnvironmentVariable('SUPABASE_HOME', $cliHomePath, 'Process')
    # Invalidar primeiro: uma senha nova nunca herda a verificacao da anterior.
    # O ID vem exclusivamente do ValidateSet, nao de SQL livre informado pelo usuario.
    $resetSql = 'DO $mailbox_reset$ BEGIN UPDATE public.email_mailboxes SET imap_verified_at = NULL, smtp_verified_at = NULL, credentials_revision = credentials_revision + 1 WHERE id = ''{0}''; IF NOT FOUND THEN RAISE EXCEPTION ''Caixa nao cadastrada''; END IF; END $mailbox_reset$;' -f $Mailbox
    try {
        $ErrorActionPreference = 'Continue' # O CLI escreve mensagens informativas em stderr.
        $cliOutput = & npx.cmd --yes supabase@2.121.0 db query --linked `
            --project-ref $projectRef --profile $ProfilePath --output-format json $resetSql 2>&1
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -ne 0) { throw 'CLI error' }
    }
    catch {
        $ErrorActionPreference = 'Stop'
        throw 'Nao foi possivel invalidar a verificacao anterior. A senha nao foi alterada.'
    }
    # A senha nao integra argv. Base64 e apenas codificacao, nao criptografia.
    # Capture a saida para impedir que erros externos exibam dados sensiveis.
    try {
        $ErrorActionPreference = 'Continue'
        $cliOutput = & npx.cmd --yes supabase@2.121.0 secrets set `
            --env-file $tempFile --project-ref $projectRef --profile $ProfilePath 2>&1
        $ErrorActionPreference = 'Stop'
        if ($LASTEXITCODE -ne 0) { throw 'CLI error' }
    }
    catch {
        $ErrorActionPreference = 'Stop'
        throw 'Nao foi possivel cadastrar o secret. Verifique o acesso do perfil Supabase e tente novamente.'
    }
    finally {
        # Invalide tambem checks que tenham iniciado enquanto o upload ocorria.
        # Executar mesmo quando o CLI falha: a resposta pode ter sido perdida.
        try {
            $ErrorActionPreference = 'Continue'
            $cliOutput = & npx.cmd --yes supabase@2.121.0 db query --linked `
                --project-ref $projectRef --profile $ProfilePath --output-format json $resetSql 2>&1
            $ErrorActionPreference = 'Stop'
            if ($LASTEXITCODE -ne 0) { throw 'CLI error' }
        }
        catch {
            $ErrorActionPreference = 'Stop'
            throw 'A senha pode ter sido atualizada, mas a verificacao final nao foi invalidada. Execute novamente este cadastro antes de usar a caixa.'
        }
    }
    $cliOutput = $null
}
finally {
    [Environment]::SetEnvironmentVariable('SUPABASE_HOME', $previousCliHome, 'Process')
    if ($passwordBstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordBstr)
    }
    if ($null -ne $passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    if ($null -ne $passwordSecure) { $passwordSecure.Dispose() }
    $passwordPlain = $null
    $passwordBase64 = $null
    $passwordSecure = $null
    $cliOutput = $null
    if ($tempFile -and (Test-Path -LiteralPath $tempFile)) {
        Remove-Item -LiteralPath $tempFile -Force
    }
    if ($tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) {
        # Sem exclusao recursiva: somente a pasta efemera que este script criou.
        Remove-Item -LiteralPath $tempDirectory -Force
    }
}

Write-Host ('Senha cadastrada para ' + $addresses[$Mailbox] + '.')
Write-Host 'A conexao ainda precisa ser verificada no dashboard autenticado antes de sincronizar ou enviar.'
