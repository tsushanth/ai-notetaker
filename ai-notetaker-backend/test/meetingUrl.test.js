const test = require('node:test');
const assert = require('node:assert/strict');
require('./helpers/meetingFakes');
const recall = require('../src/services/recallService');

const ZOOM = [
  'https://zoom.us/j/1234567890',
  'https://us02web.zoom.us/j/1234567890?pwd=abc.1',
  'https://acme.zoom.us/s/1234567890?zak=abc',
  'https://us02web.zoom.us/w/81234567890?tk=abc',
  'https://app.zoom.us/wc/1234567890/join?pwd=abc',
  'https://zoom.us/wc/join/1234567890',
  'https://zoom.com/j/1234567890',
  'https://zoom-x.de/j/1234567890',
  'https://acme.zoom.us/my/jane.doe?pwd=abc',
  'https://acme.zoom.us/meetings/1234567890/invitations?signature=x',
];

test('Zoom link forms Recall documents are accepted and detected as Zoom', () => {
  for (const url of ZOOM) {
    assert.equal(recall.validateMeetingUrl(url), true, url);
    assert.equal(recall.detectPlatform(url), 'zoom', url);
  }
});

test('zoomgov, look-alike hosts and non-meeting Zoom pages are refused', () => {
  for (const url of ['https://agency.zoomgov.com/j/1234567890', 'https://evilzoom.us/j/1234567890', 'https://zoom.us.example.com/j/1', 'https://zoom.us/pricing', 'zoom.us/j/1234567890']) {
    assert.equal(recall.validateMeetingUrl(url), false, url);
  }
  assert.equal(recall.isZoomGovUrl('https://zoomgov.com/j/1'), true);
  assert.equal(recall.isZoomGovUrl('https://zoomgov.com.example.com/j/1'), false);
  assert.equal(recall.isZoomGovUrl('https://zoom.us/j/1'), false);
});

test('other platforms are unchanged', () => {
  assert.equal(recall.validateMeetingUrl('https://meet.google.com/abc-defg-hij'), true);
  assert.equal(recall.detectPlatform('https://teams.live.com/meet/1'), 'teams');
  assert.equal(recall.detectPlatform('https://acme.webex.com/meet/x'), 'webex');
});
