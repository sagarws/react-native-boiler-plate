
/**
 * Turning ffmpeg's stderr into something an operator can act on.
 *
 * ffmpeg's own output is the best signal available - it distinguishes a wrong
 * password from a wrong path from an unreachable host, which no amount of
 * guessing at the Electron layer could - so the known phrases are mapped to
 * plain language and the raw text is kept alongside in StreamDiagnostics.
 *
 * Pure and shared so the mapping can be tested against real ffmpeg output. The
 * ORDER of these checks is load-bearing; see the note on the first one.
 */

import { APP_NAME } from './app'


/**
 * Turns an ffmpeg exit into something worth reading.
 *
 * ffmpeg's own stderr is the best signal available - it distinguishes a wrong
 * password from a wrong path from an unreachable host, which no amount of
 * guessing at the Electron layer can do - so the known phrases are mapped to
 * plain language and the raw text is kept alongside.
 */
export const summariseStreamFailure = (stderrTail: string[], bytesOut: number): string => {
  const text = stderrTail.join('\n').toLowerCase()

  // FIRST, before any camera-shaped diagnosis: ffmpeg refusing one of OUR
  // arguments. This is an app bug, not anything the operator can fix, and it
  // has to be checked first because "Option not found" contains "not found"
  // and was previously reported as a missing stream path - sending people to
  // check camera settings for a flag we passed wrong.
  if (
    text.includes('option not found') ||
    text.includes('not found.') ||
    text.includes('unrecognized option') ||
    text.includes('error splitting the argument list')
  ) {
    return `${APP_NAME} asked the video engine for something it does not support. This is a bug in the app, not a problem with the camera — please report it.`
  }

  if (text.includes('401') || text.includes('unauthorized')) {
    return 'The camera rejected the username or password in the RTSP URL.'
  }
  if (text.includes('404') || text.includes('stream not found')) {
    return 'The camera answered, but there is no stream at that path. Check the stream path in the RTSP URL.'
  }
  if (text.includes('connection refused')) {
    return 'The camera refused the connection. Check the port in the RTSP URL and that RTSP is enabled on the camera.'
  }
  if (text.includes('no route to host') || text.includes('network is unreachable')) {
    return 'The camera is not reachable from this machine. Check that both are on the same network.'
  }
  if (text.includes('timed out') || text.includes('timeout')) {
    return 'The camera did not answer in time. It may be on a different network, or blocked by a firewall.'
  }
  if (text.includes('immediate exit requested') || text.includes('invalid data found')) {
    return 'The camera sent data ffmpeg could not decode. Try the camera\'s second/sub stream.'
  }
  if (bytesOut === 0) {
    return 'Connected to the camera but no video arrived. Check the stream path, or try the second/sub stream.'
  }
  return 'The stream stopped unexpectedly.'
}
