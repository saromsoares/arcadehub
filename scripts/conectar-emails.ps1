# Assistente local para as seis caixas solicitadas; nunca imprime senhas.
$ErrorActionPreference = 'Stop'
$host.UI.RawUI.WindowTitle = 'Arcade Hub - conectar caixas da Hostinger'
Write-Host 'Cadastre a senha de cada CAIXA DE E-MAIL da Hostinger.'
Write-Host 'Use a senha do webmail, nao a senha de login do painel Hostinger.'
Write-Host 'A digitacao fica oculta. Pressione Enter sem digitar para pular uma caixa.'
Write-Host ''
foreach ($mailbox in @('cbai_solutions','jogadaca','coben','privabr','liquida_pecas','conferecheck')) {
    try {
        & (Join-Path $PSScriptRoot 'configurar-caixas-email.ps1') -Mailbox $mailbox
    } catch {
        Write-Host ('Caixa nao configurada nesta tentativa: ' + $mailbox) -ForegroundColor Yellow
        Write-Host $_.Exception.Message
    }
    Write-Host ''
}
Write-Host 'No dashboard, abra E-mails, selecione cada caixa e clique em Verificar conexao.'
Write-Host 'Depois de verificar, clique em Sincronizar para carregar os recebidos.'
$null = Read-Host 'Pressione Enter para fechar'
