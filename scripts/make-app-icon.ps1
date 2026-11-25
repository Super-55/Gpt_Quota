$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$quotaProject = Split-Path -Parent $PSScriptRoot
$quotaIconPath = Join-Path $quotaProject 'assets/QuotaGlass.ico'
$quotaPreviewPath = Join-Path $quotaProject 'assets/QuotaGlass.png'

function New-QuotaTilePath([float]$left, [float]$top, [float]$side, [float]$radius) {
    $tile = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = 2 * $radius
    $offset = $side - $diameter
    $tile.AddArc($left, $top, $diameter, $diameter, 180, 90)
    $tile.AddArc($left + $offset, $top, $diameter, $diameter, 270, 90)
    $tile.AddArc($left + $offset, $top + $offset, $diameter, $diameter, 0, 90)
    $tile.AddArc($left, $top + $offset, $diameter, $diameter, 90, 90)
    $tile.CloseFigure()
    return $tile
}

function New-QuotaIconImage([int]$size) {
    $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $tile = New-QuotaTilePath 15 12 226 54
    $shadow = New-QuotaTilePath 14 17 228 55
    $tileBox = [System.Drawing.RectangleF]::new(15, 12, 226, 226)
    $tileFill = [System.Drawing.Drawing2D.LinearGradientBrush]::new($tileBox, [System.Drawing.Color]::FromArgb(102, 63, 94), [System.Drawing.Color]::FromArgb(29, 22, 38), 62)
    $tileEdge = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(146, 235, 162, 201), 3)
    $shadowFill = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(65, 20, 11, 24))
    $ringBox = [System.Drawing.RectangleF]::new(62, 54, 132, 134)
    $ringRail = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(152, 100, 132), 21)
    $ringFill = [System.Drawing.Drawing2D.LinearGradientBrush]::new($tileBox, [System.Drawing.Color]::FromArgb(255, 238, 248), [System.Drawing.Color]::FromArgb(239, 146, 195), 60)
    $ringStroke = [System.Drawing.Pen]::new($ringFill, 21)
    try {
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.ScaleTransform($size / 256.0, $size / 256.0)
        $graphics.FillPath($shadowFill, $shadow)
        $graphics.FillPath($tileFill, $tile)
        $graphics.DrawPath($tileEdge, $tile)
        $ringStroke.StartCap = $ringStroke.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
        $graphics.DrawEllipse($ringRail, $ringBox)
        $graphics.DrawArc($ringStroke, $ringBox, -90, 308)
        $graphics.DrawLine($ringStroke, 143, 155, 183, 194)
        $stream = [System.IO.MemoryStream]::new()
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return ,($stream.ToArray())
        } finally { $stream.Dispose() }
    } finally {
        foreach ($item in @($graphics, $bitmap, $tile, $shadow, $tileFill, $tileEdge, $shadowFill, $ringRail, $ringFill, $ringStroke)) { $item.Dispose() }
    }
}

$quotaSizes = @(16, 24, 32, 48, 64, 128, 256)
$quotaImages = @{}
foreach ($size in $quotaSizes) { $quotaImages[$size] = New-QuotaIconImage $size }
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $quotaIconPath)) | Out-Null
[System.IO.Directory]::CreateDirectory((Split-Path -Parent $quotaPreviewPath)) | Out-Null
[System.IO.File]::WriteAllBytes($quotaPreviewPath, $quotaImages[256])

$quotaWriter = [System.IO.BinaryWriter]::new([System.IO.File]::Create($quotaIconPath))
try {
    $quotaWriter.Write([uint16]0)
    $quotaWriter.Write([uint16]1)
    $quotaWriter.Write([uint16]$quotaSizes.Count)
    $quotaOffset = 6 + 16 * $quotaSizes.Count
    foreach ($size in $quotaSizes) {
        $side = if ($size -eq 256) { 0 } else { $size }
        $quotaWriter.Write([byte]$side)
        $quotaWriter.Write([byte]$side)
        $quotaWriter.Write([byte]0)
        $quotaWriter.Write([byte]0)
        $quotaWriter.Write([uint16]1)
        $quotaWriter.Write([uint16]32)
        $quotaWriter.Write([uint32]$quotaImages[$size].Length)
        $quotaWriter.Write([uint32]$quotaOffset)
        $quotaOffset += $quotaImages[$size].Length
    }
    foreach ($size in $quotaSizes) { $quotaWriter.Write([byte[]]$quotaImages[$size]) }
} finally { $quotaWriter.Dispose() }
[System.IO.File]::Copy($quotaIconPath, (Join-Path $quotaProject 'release/QuotaGlass.ico'), $true)
[System.IO.File]::Copy($quotaPreviewPath, (Join-Path $quotaProject 'artifacts/quotaglass-icon.png'), $true)
Get-Item -LiteralPath $quotaIconPath, $quotaPreviewPath | Select-Object FullName, Length
