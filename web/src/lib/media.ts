// Camera/mic access. Browsers only expose navigator.mediaDevices on a secure page
// (https, or http://localhost), so a LAN http address gets a clear message instead of a crash.
export async function getMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      `The camera and mic need a secure page. Open https://${location.hostname}:5173 ` +
        '(accept the certificate warning once).',
    )
  }
  return navigator.mediaDevices.getUserMedia(constraints)
}
