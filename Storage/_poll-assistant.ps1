$deadline = (Get-Date).AddSeconds(360)
do {
  Start-Sleep -Seconds 10
  $js = @'
const root = document.querySelector("[data-module=assistant]");
const text = root?.innerText || "";
const ta = [...document.querySelectorAll("textarea")].find(t => (t.placeholder || "").includes("Ask Assistant"));
const send = ta && [...ta.parentElement.parentElement.querySelectorAll("button")].find(b => (b.textContent || "").trim() === "Send");
const stopVisible = [...(root?.querySelectorAll("button") || [])].some(b => (b.textContent || "").trim() === "Stop" && !b.hidden);
const chips = (text.match(/Finding by name|Creating script|Writing script|Reading script|Reading script guide|Linting script|Auditing scripts|Probing Live scripts|Reparenting|Deleting|Listing scene|Checking Live|Updating parts/g) || []);
({ stopVisible, sendDisabled: !!send?.disabled, chips, tail: text.slice(-800), len: text.length })
'@
  $payload = [ordered]@{
    jsonrpc = '2.0'
    id = 302
    method = 'tools/call'
    params = [ordered]@{
      name = 'eval_js'
      arguments = [ordered]@{ code = $js; timeoutMs = 10000 }
    }
  }
  [System.IO.File]::WriteAllText("$pwd\Storage\_mcp-call.json", ($payload | ConvertTo-Json -Depth 6 -Compress))
  curl.exe -s -X POST http://127.0.0.1:5281/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" --data-binary "@Storage\_mcp-call.json" -o "Storage\_mcp-out.txt" | Out-Null
  $raw = Get-Content "Storage\_mcp-out.txt" -Raw
  $stop = if ($raw -match 'stopVisible\\u0022:\s*(true|false)') { $Matches[1] } else { '?' }
  $sendDis = if ($raw -match 'sendDisabled\\u0022:\s*(true|false)') { $Matches[1] } else { '?' }
  Write-Host ("{0} stop={1} sendDis={2}" -f (Get-Date -Format HH:mm:ss), $stop, $sendDis)
  if ($stop -eq 'false' -and $sendDis -eq 'false') {
    if ($raw -match 'Creating script|Writing script|Reading script guide|part-') { break }
  }
} while ((Get-Date) -lt $deadline)
Write-Host 'POLL END'
node -e "const fs=require('fs'); const raw=fs.readFileSync('Storage/_mcp-out.txt','utf8'); const m=raw.match(/data: (\{.*\})/); const d=JSON.parse(JSON.parse(m[1]).result.content[0].text); console.log('chips', d.chips); console.log('TAIL:'); console.log(d.tail);"

