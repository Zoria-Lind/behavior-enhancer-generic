Add-Type -AssemblyName System.Drawing

$srcPath = 'D:\dsh\dsh-plugins\behavior-enhancer-generic\publish\agensi-skill\behavior-enhancer-skill-logo_template.jpeg'
$outPath = 'D:\dsh\dsh-plugins\behavior-enhancer-generic\publish\agensi-skill\behavior-enhancer-skill-logo.png'

$src = [System.Drawing.Image]::FromFile($srcPath)
$bmp = New-Object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.DrawImage($src, 0, 0, 512, 512)
$bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
$src.Dispose()

$out = [System.Drawing.Image]::FromFile($outPath)
Write-Output ("saved: " + $out.Width + "x" + $out.Height + " " + (Get-Item $outPath).Length + " bytes")
$out.Dispose()
