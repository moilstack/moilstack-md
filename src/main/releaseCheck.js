const https = require('https')
const { app, BrowserWindow } = require('electron')

// "owner/repo" — used to query the GitHub Releases API and to build the
// release page URL shown in the notification.
const REPO = 'moilstack/moilstack-md'
const CHECK_DELAY_MS = 5000

/** Fetch the latest published (non-draft, non-prerelease) GitHub release. */
function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      headers: { 'User-Agent': 'moilstack-md', Accept: 'application/vnd.github+json' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`GitHub API responded ${res.statusCode}`))
        return
      }
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(body)) } catch (err) { reject(err) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')))
  })
}

/** True if version `a` (e.g. "1.2.0") is newer than `b`. */
function isNewer(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na !== nb) return na > nb
  }
  return false
}

async function checkForNewRelease() {
  try {
    const release = await fetchLatestRelease()
    const latestVersion = String(release.tag_name || '').replace(/^v/, '')
    if (!latestVersion || !isNewer(latestVersion, app.getVersion())) return

    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('release:available', { version: latestVersion, url: release.html_url })
    }
  } catch (err) {
    // Offline, rate-limited, or no releases published yet — never bother the user about it.
    console.error('[releaseCheck]', err)
  }
}

/** Check once, a few seconds after launch (gives the window time to load first). */
function startReleaseCheck() {
  setTimeout(checkForNewRelease, CHECK_DELAY_MS)
}

module.exports = { startReleaseCheck }
