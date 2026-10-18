$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$artRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$assetRoot = Join-Path $artRoot '2026-10-17'
$zipPath = Join-Path $PSScriptRoot 'art-artifacts-sanitized.zip'
$groups = @{
 'game-assets-v1' = 'legacy_local_procedural'
 'game-assets-v2' = 'legacy_local_procedural_textured'
 'game-assets-v3' = 'complete_local_procedural_fleet_unapproved'
 'kestrel-game-art-v4' = 'latest_local_procedural_kestrel_unapproved'
 'kestrel-higgsfield-trial' = 'historical_preparation_no_higgsfield_model'
 'kestrel-higgsfield-v1' = 'blocked_no_higgsfield_model'
}
$excludedNames = @('process-ownership.json','setup-result.json','model-catalog.json','model-schema.json','generation-output.log','verification-output.txt')
$secretPattern = '(?i)(?:access_token|refresh_token|client_secret)["'']?\s*[:=]\s*["''][^"'']{8,}|Bearer\s+[A-Za-z0-9._-]{16,}|sk-[A-Za-z0-9_-]{20,}|higgsfield-auth-|code_challenge=|"(?:email|workspace_id|account_id|creditsBefore|creditsAfter|free_gens)"\s*:'
$textTypes = @('.json','.md','.txt','.js','.mjs','.cjs','.html','.ps1')
$records = @()
$payloads = @{}
$expectedModelHashes = @{}
$modelChecks = @()
foreach ($group in $groups.Keys) {
 $geometryReport = Join-Path $assetRoot "$group/geometry-validation.json"
 if (Test-Path -LiteralPath $geometryReport) {
  $geometry = Get-Content -LiteralPath $geometryReport -Raw | ConvertFrom-Json
  foreach ($model in $geometry.models) {
   if ($model.sha256) { $expectedModelHashes["$group/models/$($model.id).glb"] = $model.sha256 }
  }
 }
}
foreach ($file in (Get-ChildItem -LiteralPath $assetRoot -Recurse -File | Sort-Object FullName)) {
 $relative = $file.FullName.Substring($assetRoot.Length + 1).Replace('\','/')
 $first = $relative.Split('/')[0]
 $status = if ($groups.ContainsKey($first)) { $groups[$first] } else { 'historical_direction_or_original_reference' }
 $include = $true
 $reason = 'Versioned source, asset or review evidence.'
 if ($file.Extension -eq '.zip') { $include = $false; $reason = 'Duplicate legacy archive. Unpacked payload is included where safe. Original archive remains unchanged on disk.' }
 elseif ($excludedNames -contains $file.Name) { $include = $false; $reason = 'Account or catalog metadata, or raw process record. Preserve locally only.' }
 elseif ($relative -match '/engine-snapshot/') { $include = $false; $reason = 'Generated application code snapshot. Application repository owns this source. Import test evidence is retained separately.' }
 elseif ($relative -match '(^|/)(\.env[^/]*|node_modules|\.cache|\.git|browser-profile|user-data)(/|$)') { throw "Forbidden source path found. $relative" }
 $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
 $transform = 'none'
 $artifactHash = $sourceHash
 $artifactBytes = $file.Length
 if ($include -and $textTypes -contains $file.Extension) {
  $content = [IO.File]::ReadAllText($file.FullName)
  if ($content -match $secretPattern) { throw "Forbidden credential or account-data pattern in $relative" }
  if ($file.Name -in @('verification.json','study-verification.json')) {
   $report = $content | ConvertFrom-Json
   foreach ($key in @('processes','owner')) { $report.PSObject.Properties.Remove($key) }
   $bytes = [Text.Encoding]::UTF8.GetBytes(($report | ConvertTo-Json -Depth 100))
   $payloads[$relative] = $bytes
   $transform = 'Package copy omits process IDs and ownership metadata. Original report unchanged.'
   $hasher = [Security.Cryptography.SHA256]::Create()
   try { $artifactHash = [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose() }
   $artifactBytes = $bytes.Length
  }
 }
 if ($file.Extension -eq '.glb') {
  $bytes = [IO.File]::ReadAllBytes($file.FullName)
  if ([BitConverter]::ToUInt32($bytes,0) -ne 0x46546c67 -or [BitConverter]::ToUInt32($bytes,4) -ne 2 -or [BitConverter]::ToUInt32($bytes,8) -ne $bytes.Length) { throw "Invalid GLB header. $relative" }
  $jsonLength = [BitConverter]::ToUInt32($bytes,12)
  $docText = [Text.Encoding]::UTF8.GetString($bytes,20,$jsonLength)
  if ($docText -match $secretPattern) { throw "Forbidden GLB metadata. $relative" }
  $doc = $docText | ConvertFrom-Json
  if ($doc.asset.version -ne '2.0' -or !$doc.meshes.Count) { throw "Missing glTF meshes. $relative" }
  if ($expectedModelHashes.ContainsKey($relative) -and $expectedModelHashes[$relative] -ne $sourceHash) { throw "Saved model checksum mismatch. $relative" }
  $modelChecks += [ordered]@{path=$relative;validGlbHeader=$true;meshes=$doc.meshes.Count;savedHashCompared=$expectedModelHashes.ContainsKey($relative);sha256=$sourceHash}
 }
 $recommendation = if (!$include) { 'omit_from_transfer' } elseif ($file.Extension -in @('.glb','.png') -and $relative.Contains('/')) { 'release_asset' } elseif ($file.Extension -eq '.html') { 'release_review_page' } else { 'reference_or_source' }
 if ($file.Name -eq 'standalone-preview.html' -or $file.Name -eq 'standalone-study.html') { $recommendation = 'release_only_duplicate_embed' }
 if ($file.Length -gt 50MB) { $recommendation = 'release_only_over_50_MiB' }
 $records += [ordered]@{path="2026-10-17/$relative";status=$status;productionApproved=$false;bytes=$file.Length;sha256=$sourceHash;over50MiB=($file.Length -gt 50MB);includeInRelease=$include;inclusionReason=$reason;gitRecommendation=$recommendation;transformation=$transform;releaseBytes=$artifactBytes;releaseSha256=$artifactHash}
}
if ($modelChecks.Count -ne 14) { throw "Expected fourteen preserved local GLBs. Found $($modelChecks.Count)." }
$original = $records | Where-Object path -eq '2026-10-17/starseeker-01-kestrel.png'
if ($original.sha256 -ne 'fe34453022ea00598e3261964dfd48546003826b16ecd0e574e74c75a4a138f8') { throw 'Original Kestrel concept checksum changed.' }
$hfModels = @(Get-ChildItem -LiteralPath (Join-Path $assetRoot 'kestrel-higgsfield-v1/models') -File -Filter '*.glb')
if ($hfModels.Count -ne 0) { throw 'Unexpected Higgsfield output requires a new provenance review.' }
$owned = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('node.exe','chrome.exe','higgsfield.exe') -and $_.CommandLine -like "*$artRoot*" })
if ($owned.Count) { throw 'An art-owned process is still running. Inspect its identity before stopping it.' }
$manifest = [ordered]@{preparedFor='2026-10-19';preparedOn='2026-10-18';timezone='America/Toronto';sourceRoot='art/2026-10-17';repository=@{branch='master';commit=$null;remote=$null;state='unborn HEAD; art untracked; coordinator integrates serially'};localModelCount=14;higgsfieldModelCount=0;records=$records}
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'artifact-manifest.json') -Encoding utf8
$entryExpectations = @{}
$stream = [IO.File]::Open($zipPath,[IO.FileMode]::Create)
try {
 $zip = New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$true)
 try {
  foreach ($record in ($records | Where-Object includeInRelease)) {
   $relative = $record.path.Substring('2026-10-17/'.Length)
   $entry = $zip.CreateEntry($record.path,[IO.Compression.CompressionLevel]::Optimal)
   $output = $entry.Open()
   try {
    if ($payloads.ContainsKey($relative)) { $bytes = $payloads[$relative]; $output.Write($bytes,0,$bytes.Length) }
    else { $input = [IO.File]::OpenRead((Join-Path $assetRoot $relative)); try { $input.CopyTo($output) } finally { $input.Dispose() } }
   } finally { $output.Dispose() }
   $entryExpectations[$record.path] = $record.releaseSha256
  }
  foreach ($name in @('README.md','site-generation-prompt.txt','package-art.ps1','artifact-manifest.json')) {
   $path = Join-Path $PSScriptRoot $name
   if ($name -ne 'package-art.ps1' -and ([IO.File]::ReadAllText($path) -match $secretPattern)) { throw "Forbidden package metadata. $name" }
   $entry = $zip.CreateEntry("handoff-2026-10-19/$name",[IO.Compression.CompressionLevel]::Optimal)
   $output = $entry.Open(); $input = [IO.File]::OpenRead($path)
   try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
   $entryExpectations[$entry.FullName] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
  }
 } finally { $zip.Dispose() }
} finally { $stream.Dispose() }
$zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
$entryChecks = @()
try {
 if ($zip.Entries.Count -ne $entryExpectations.Count) { throw 'Archive entry count mismatch.' }
 foreach ($entry in $zip.Entries) {
  if (!$entryExpectations.ContainsKey($entry.FullName)) { throw "Unexpected archive entry. $($entry.FullName)" }
  $input = $entry.Open(); $hasher = [Security.Cryptography.SHA256]::Create()
  try { $hash = [BitConverter]::ToString($hasher.ComputeHash($input)).Replace('-','').ToLowerInvariant() } finally { $hasher.Dispose(); $input.Dispose() }
  if ($hash -ne $entryExpectations[$entry.FullName]) { throw "Archive content mismatch. $($entry.FullName)" }
  $entryChecks += [ordered]@{path=$entry.FullName;bytes=$entry.Length;sha256=$hash}
 }
} finally { $zip.Dispose() }
$negativeExpected = '0' * 64
$negativeRejected = $entryChecks[0].sha256 -ne $negativeExpected
if (!$negativeRejected) { throw 'Wrong-digest negative control failed.' }
$entryChecks | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'release-entries.json') -Encoding utf8
$verification = [ordered]@{completed=$true;scope='Art handoff inventory and transfer verification only. No new generation, browser render, application test, commit, push or merge.';sourceFileCount=$records.Count;sourceBytes=($records | ForEach-Object { $_.bytes } | Measure-Object -Sum).Sum;includedAssetFiles=@($records | Where-Object includeInRelease).Count;excludedFiles=@($records | Where-Object { !$_.includeInRelease }).Count;archiveEntries=$entryChecks.Count;archiveBytes=(Get-Item -LiteralPath $zipPath).Length;archiveSha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant();everyArchiveEntryVerified=$true;wrongDigestNegativeControlRejected=$negativeRejected;originalKestrelUnchanged=$true;higgsfieldModelCount=0;ownedArtProcesses=0;largeSourceFiles=@($records | Where-Object over50MiB | ForEach-Object { [ordered]@{path=$_.path;bytes=$_.bytes} });modelChecks=$modelChecks;remaining='User website generation and GLB review. Coordinator serial integration.'}
$verification | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'handoff-verification.json') -Encoding utf8
$checksumLines = foreach ($name in @('art-artifacts-sanitized.zip','README.md','artifact-manifest.json','release-entries.json','handoff-verification.json','site-generation-prompt.txt','package-art.ps1')) { $hash = (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $name) -Algorithm SHA256).Hash.ToLowerInvariant(); "$hash  $name" }
$checksumLines | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'SHA256SUMS.txt') -Encoding utf8
[ordered]@{completed=$true;files=$records.Count;models=$modelChecks.Count;higgsfieldModels=0;archiveEntries=$entryChecks.Count;archiveBytes=$verification.archiveBytes;excluded=$verification.excludedFiles;ownedArtProcesses=0} | ConvertTo-Json
