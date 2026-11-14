# Local dialog: the key never becomes a shell command or a process argument.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$repoRoot = Split-Path -Parent $PSScriptRoot
$form = New-Object Windows.Forms.Form
$form.Text = 'Conectar Stripe ClickDrop - Arcade Hub'
$form.ClientSize = New-Object Drawing.Size(600, 270)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.TopMost = $true

$label = New-Object Windows.Forms.Label
$label.Text = "Cole a chave restrita de PRODUCAO da conta ClickDrop (rk_live_).`r`nA chave da conta ARCADE HUB TECH sera mantida."
$label.Location = New-Object Drawing.Point(22, 20)
$label.Size = New-Object Drawing.Size(555, 44)
$field = New-Object Windows.Forms.TextBox
$field.Location = New-Object Drawing.Point(22, 80)
$field.Size = New-Object Drawing.Size(555, 26)
$field.UseSystemPasswordChar = $true
$field.MaxLength = 512
$save = New-Object Windows.Forms.Button
$save.Text = 'Validar e salvar no Supabase'
$save.Location = New-Object Drawing.Point(22, 125)
$save.Size = New-Object Drawing.Size(270, 36)
$cancel = New-Object Windows.Forms.Button
$cancel.Text = 'Fechar'
$cancel.Location = New-Object Drawing.Point(307, 125)
$cancel.Size = New-Object Drawing.Size(120, 36)
$status = New-Object Windows.Forms.Label
$status.Text = 'A chave fica oculta e nao sera gravada no codigo nem no chat.'
$status.Location = New-Object Drawing.Point(22, 180)
$status.Size = New-Object Drawing.Size(555, 68)
$form.Controls.AddRange(@($label, $field, $save, $cancel, $status))
$form.AcceptButton = $save
$form.CancelButton = $cancel
$cancel.Add_Click({ $form.Close() })
$save.Add_Click({
    if ([string]::IsNullOrWhiteSpace($field.Text)) { $status.Text = 'Cole a chave no campo acima antes de salvar.'; return }
    $save.Enabled = $false
    $cancel.Enabled = $false
    $status.Text = 'Validando a conta e salvando a chave. Aguarde...'
    $form.UseWaitCursor = $true
    [Windows.Forms.Application]::DoEvents()
    $secure = $null
    try {
        $secure = ConvertTo-SecureString $field.Text.Trim() -AsPlainText -Force
        $field.Clear()
        & (Join-Path $PSScriptRoot 'configurar-stripe-clickdrop.ps1') -ApiKey $secure
        $status.ForeColor = [Drawing.Color]::DarkGreen
        $status.Text = 'Conta ClickDrop validada e chave salva no Supabase. Pode fechar esta janela.'
        $save.Visible = $false
        $field.Enabled = $false
    } catch {
        # Do not serialize arbitrary exceptions, HTTP responses or submitted input.
        $allowed = @(
            'Informe uma chave restrita de producao (rk_live_). Nenhuma alteracao foi enviada.',
            'A chave nao pode consultar a conta. Confira a permissao de leitura da conta.',
            'A chave pertence a outra conta Stripe. Nenhum segredo foi alterado.',
            'Falta permissao para consultar saldo, cobrancas ou transacoes de saldo. Nenhum segredo foi alterado.',
            'A conta retornou dados de teste. Nenhum segredo foi alterado.',
            'Nao foi possivel salvar os segredos no Supabase. Confira o perfil e tente novamente.',
            'Perfil Supabase local ausente.'
        )
        $message = 'Falha local ao cadastrar a chave. Nenhuma credencial sera exibida. Avise o Codex.'
        if ($allowed -contains $_.Exception.Message) { $message = $_.Exception.Message }
        @{ ok = $false; message = $message; checked_at = [DateTime]::UtcNow.ToString('o') } |
            ConvertTo-Json | Set-Content -LiteralPath (Join-Path $repoRoot '.aiox/stripe-clickdrop-setup-error.json') -Encoding UTF8
        $status.ForeColor = [Drawing.Color]::DarkRed
        $status.Text = $message
        $save.Enabled = $true
    } finally {
        if ($null -ne $secure) { $secure.Dispose() }
        $field.Clear()
        $cancel.Enabled = $true
        $form.UseWaitCursor = $false
    }
})
$form.Add_Shown({ $field.Focus() })
$null = $form.ShowDialog()
$field.Clear()
$form.Dispose()
