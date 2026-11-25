import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMeetingUrl, meetingFailureText, ZOOM_NO_PASSCODE, ZOOMGOV_UNSUPPORTED } from '../src/lib/meetings.ts';

test('Zoom link forms are accepted', () => {
  for (const url of [
    'https://us02web.zoom.us/j/1234567890?pwd=abc',
    'https://us02web.zoom.us/w/81234567890?tk=abc',
    'https://app.zoom.us/wc/1234567890/join?pwd=abc',
    'https://zoom.us/wc/join/1234567890?pwd=abc',
    'https://zoom.com/j/1234567890?pwd=abc',
    'https://acme.zoom.us/s/1234567890?zak=x&pwd=abc',
  ]) {
    assert.deepEqual(validateMeetingUrl(url), { valid: true, platform: 'zoom' }, url);
  }
});

test('a Zoom link without a passcode is accepted with a warning', () => {
  for (const url of ['https://zoom.us/j/1234567890', 'https://zoom.us/my/jane', 'https://zoom.us/j/1234567890?pwd=']) {
    assert.deepEqual(validateMeetingUrl(url), { valid: true, platform: 'zoom', warning: ZOOM_NO_PASSCODE }, url);
  }
});

test('zoomgov is refused with its own reason; look-alikes are just invalid', () => {
  assert.deepEqual(validateMeetingUrl('https://agency.zoomgov.com/j/1234567890'), { valid: false, platform: null, error: ZOOMGOV_UNSUPPORTED });
  assert.deepEqual(validateMeetingUrl('https://evilzoom.us/j/1234567890'), { valid: false, platform: null });
  assert.deepEqual(validateMeetingUrl('https://zoom.us/pricing'), { valid: false, platform: null });
});

test('other platforms are unchanged and carry no warning', () => {
  assert.deepEqual(validateMeetingUrl('https://meet.google.com/abc-defg-hij'), { valid: true, platform: 'google_meet' });
  assert.deepEqual(validateMeetingUrl('https://teams.live.com/meet/1'), { valid: true, platform: 'teams' });
  assert.deepEqual(validateMeetingUrl('nonsense'), { valid: false, platform: null });
});

test('failure text: only failed meetings, the stored reason first', () => {
  assert.equal(meetingFailureText({ status: 'failed', error_message: 'The meeting could not be found.' }), 'The meeting could not be found.');
  assert.match(meetingFailureText({ status: 'failed', error_message: null })!, /could not record/);
  assert.equal(meetingFailureText({ status: 'completed', error_message: 'old' }), null);
});
