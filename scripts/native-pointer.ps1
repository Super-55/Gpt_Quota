$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class QuotaPointerTest {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
}
'@
[QuotaPointerTest]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null
[Console]::WriteLine('ready')
try {
    while ($null -ne ($quotaPointerLine = [Console]::ReadLine())) {
        $quotaPointerAction = $quotaPointerLine | ConvertFrom-Json
        if ($quotaPointerAction.action -eq 'quit') { break }
        if ($quotaPointerAction.action -eq 'restore') {
            [QuotaPointerTest]::SetCursorPos([int]$quotaPointerAction.point.x, [int]$quotaPointerAction.point.y) | Out-Null
            continue
        }
        [QuotaPointerTest]::SetCursorPos([int]$quotaPointerAction.start.x, [int]$quotaPointerAction.start.y) | Out-Null
        Start-Sleep -Milliseconds 120
        [QuotaPointerTest]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 100
        $quotaPointerSteps = if ($quotaPointerAction.steps) { [int]$quotaPointerAction.steps } else { 12 }
        for ($quotaPointerIndex = 1; $quotaPointerIndex -le $quotaPointerSteps; $quotaPointerIndex++) {
            $quotaPointerX = [int]($quotaPointerAction.start.x + ($quotaPointerAction.end.x - $quotaPointerAction.start.x) * $quotaPointerIndex / $quotaPointerSteps)
            $quotaPointerY = [int]($quotaPointerAction.start.y + ($quotaPointerAction.end.y - $quotaPointerAction.start.y) * $quotaPointerIndex / $quotaPointerSteps)
            [QuotaPointerTest]::SetCursorPos($quotaPointerX, $quotaPointerY) | Out-Null
            Start-Sleep -Milliseconds 28
        }
        [QuotaPointerTest]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 180
        [Console]::WriteLine('done')
    }
} finally {
    [QuotaPointerTest]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}
