Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$bgColor = [System.Drawing.Color]::FromArgb(255, 15, 23, 42)      # slate-900
$skyColor = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)   # sky-400 描边
$innerColor = [System.Drawing.Color]::FromArgb(255, 30, 41, 59)   # slate-800 内盾
$whiteColor = [System.Drawing.Color]::FromArgb(255, 248, 250, 252)

$g.Clear($bgColor)

# 外盾(描边色)
$outer = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point(160, 84)),
    (New-Object System.Drawing.Point(352, 84)),
    (New-Object System.Drawing.Point(352, 320)),
    (New-Object System.Drawing.Point(256, 428)),
    (New-Object System.Drawing.Point(160, 320))
)
$outerBrush = New-Object System.Drawing.SolidBrush($skyColor)
$g.FillPolygon($outerBrush, $outer)

# 内盾(底)
$inner = [System.Drawing.Point[]]@(
    (New-Object System.Drawing.Point(176, 100)),
    (New-Object System.Drawing.Point(336, 100)),
    (New-Object System.Drawing.Point(336, 316)),
    (New-Object System.Drawing.Point(256, 412)),
    (New-Object System.Drawing.Point(176, 316))
)
$innerBrush = New-Object System.Drawing.SolidBrush($innerColor)
$g.FillPolygon($innerBrush, $inner)

# 对勾:沿线印章圆点(无 Pen,纯 FillEllipse)
$whiteBrush = New-Object System.Drawing.SolidBrush($whiteColor)
$segs = @(
    @(198, 262, 240, 304),
    @(240, 304, 322, 196)
)
$d = 30
foreach ($s in $segs) {
    $x1 = [double]$s[0]; $y1 = [double]$s[1]; $x2 = [double]$s[2]; $y2 = [double]$s[3]
    $dist = [math]::Sqrt((($x2 - $x1) * ($x2 - $x1)) + (($y2 - $y1) * ($y2 - $y1)))
    $steps = [math]::Max(1, [int]($dist / 6))
    for ($i = 0; $i -le $steps; $i++) {
        $t = $i / $steps
        $cx = $x1 + ($x2 - $x1) * $t
        $cy = $y1 + ($y2 - $y1) * $t
        $g.FillEllipse($whiteBrush, [single]($cx - $d / 2), [single]($cy - $d / 2), [single]$d, [single]$d)
    }
}

$out = 'D:\dsh\dsh-plugins\behavior-enhancer-generic\publish\behavior-enhancer-skill-logo.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output "saved: $out"
