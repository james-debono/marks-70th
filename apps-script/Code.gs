/**
 * Mark's 70th Birthday: RSVP receiver
 *
 * This script lives inside the "Mark's 70th RSVPs" Google Sheet
 * (Extensions > Apps Script). The invite website sends each RSVP here, and the script:
 *   1. writes one row per guest to the "RSVPs" tab,
 *   2. marks earlier rows for the same names as "Replaced", so the Summary tab
 *      only counts each person's latest reply,
 *   3. emails the guest a confirmation, if they gave an email address.
 *
 * After editing this file you must publish a new version, or the website keeps
 * using the old one: Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 * The web app URL stays the same.
 *
 * @OnlyCurrentDoc
 */

var SETTINGS = {
  // Send guests a confirmation email when they give an address.
  sendConfirmationEmails: true,
  // Optional: email the hosts on every RSVP. Comma-separated, e.g. 'you@gmail.com, sister@gmail.com'
  notifyEmails: '',
  // Name shown as the sender of the emails (they come from the Google account that deployed this).
  senderName: "Mark's 70th Birthday",
  sheetName: 'RSVPs',
  maxGuestsPerReply: 12,
  // Limit on confirmation emails to one address in 6 hours, so the form can't be used to spam someone.
  maxEmailsPerAddress: 3
};

var EVENT = {
  title: "Mark's 70th Birthday Celebration",
  when: 'Saturday 12 December 2026, 1:00 pm to 7:00 pm',
  venue: 'The Criterion Hotel, Balcony Room',
  venueNote: 'Upstairs, with lift and stair access',
  address: '90 Macalister Street, Sale VIC 3850',
  details: 'Canapés and drinks provided.',
  dressCode: 'Smart casual',
  siteUrl: 'https://james-debono.github.io/marks-70th/',
  icsUrl: 'https://james-debono.github.io/marks-70th/event.ics',
  googleCalendarUrl: 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    '&text=' + encodeURIComponent("Mark's 70th Birthday Celebration") +
    '&dates=20261212T020000Z%2F20261212T080000Z' +
    '&location=' + encodeURIComponent('The Criterion Hotel (Balcony Room), 90 Macalister St, Sale VIC 3850') +
    '&details=' + encodeURIComponent('Canapés and drinks provided. Dress code: smart casual. ' +
      'Balcony Room is upstairs, with lift and stair access.\n\nInvitation: https://james-debono.github.io/marks-70th/') +
    '&ctz=Australia%2FMelbourne',
  mapUrl: 'https://www.google.com/maps/search/?api=1&query=The%20Criterion%20Hotel%2C%2090%20MacAlister%20St%2C%20Sale%2C%20VIC%203850&query_place_id=ChIJs_lGnggvL2sRT---xCApryQ',
  cardUrl: 'https://join.au.grouptogether.com/contribute/3036c155-bac2-442c-af90-9c3ebd19ccc1'
};

var HEADERS = ['Submitted', 'Name', 'Attending', 'Dietary requirements', 'Replied by', 'Email', 'Message', 'Status', 'Reply ID'];
var COL = { name: 2, status: 8, replyId: 9 };

/** Health check. The website calls this when the RSVP form opens, to wake the script up. */
function doGet() {
  return json_({ ok: true });
}

/** Receives an RSVP from the website. */
function doPost(e) {
  var data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Sorry, that RSVP could not be read. Please try again.' });
  }

  // Hidden "website" field: people never see it, spam bots fill it in.
  if (data.website) return json_({ ok: true, replyId: 'ignored' });

  var reply = validate_(data);
  if (reply.error) return json_({ ok: false, error: reply.error });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, error: 'Lots of people are replying right now. Please try again in a moment.' });
  }

  var duplicate;
  try {
    var sheet = getSheet_();
    duplicate = replyExists_(sheet, reply.replyId);
    if (!duplicate) {
      markReplaced_(sheet, reply.guests);
      appendReply_(sheet, reply);
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }

  var emailed = false;
  if (duplicate) {
    // The same reply arrived twice (e.g. a retry after a slow connection). It's already saved.
    emailed = Boolean(reply.email && SETTINGS.sendConfirmationEmails);
  } else {
    emailed = sendConfirmation_(reply);
    notifyHosts_(reply);
  }
  return json_({ ok: true, replyId: reply.replyId, emailed: emailed });
}

function validate_(data) {
  var attending = data.attending === 'yes' ? 'Yes' : data.attending === 'no' ? 'No' : '';
  if (!attending) return { error: 'Please choose whether you can make it.' };

  var guests = [];
  var list = Array.isArray(data.guests) ? data.guests : [];
  for (var i = 0; i < list.length && guests.length < SETTINGS.maxGuestsPerReply; i++) {
    var guest = list[i] || {};
    var name = oneLine_(guest.name, 80);
    if (!name) continue;
    var dietary = attending === 'Yes' ? oneLine_(guest.dietary, 200) : '';
    if (/^(none|nil|nope|no|n\/?a|nothing|-+|\.+)$/i.test(dietary)) dietary = '';
    guests.push({ name: name, dietary: dietary });
  }
  if (!guests.length) return { error: 'Please enter at least one name.' };

  var email = oneLine_(data.email, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "That email address doesn't look right. Please check it, or leave it blank." };
  }

  var message = String(data.message == null ? '' : data.message).replace(/\r\n?/g, '\n').trim().slice(0, 1000);
  var replyId = String(data.replyId || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || Utilities.getUuid();

  return { attending: attending, guests: guests, email: email, message: message, replyId: replyId };
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SETTINGS.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS.sheetName);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function replyExists_(sheet, replyId) {
  var last = sheet.getLastRow();
  if (last < 2) return false;
  return Boolean(sheet.getRange(2, COL.replyId, last - 1, 1)
    .createTextFinder(replyId).matchEntireCell(true).findNext());
}

/** Marks earlier "Current" rows for the same people as "Replaced". */
function markReplaced_(sheet, guests) {
  var last = sheet.getLastRow();
  if (last < 2) return;
  var wanted = {};
  guests.forEach(function (g) { wanted[nameKey_(g.name)] = true; });

  var names = sheet.getRange(2, COL.name, last - 1, 1).getValues();
  var statusRange = sheet.getRange(2, COL.status, last - 1, 1);
  var statuses = statusRange.getValues();
  var changed = false;
  for (var i = 0; i < names.length; i++) {
    if (statuses[i][0] === 'Current' && wanted[nameKey_(names[i][0])]) {
      statuses[i][0] = 'Replaced';
      changed = true;
    }
  }
  if (changed) statusRange.setValues(statuses);
}

function appendReply_(sheet, reply) {
  var now = new Date();
  var lead = reply.guests[0].name;
  var rows = reply.guests.map(function (g, i) {
    return [
      now,
      cell_(g.name),
      reply.attending,
      cell_(g.dietary),
      cell_(lead),
      i === 0 ? cell_(reply.email) : '',
      i === 0 ? cell_(reply.message) : '',
      'Current',
      reply.replyId
    ];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
}

function sendConfirmation_(reply) {
  if (!SETTINGS.sendConfirmationEmails || !reply.email) return false;
  try {
    if (MailApp.getRemainingDailyQuota() < 5) return false;

    var cache = CacheService.getScriptCache();
    var key = 'mail:' + reply.email;
    var sent = Number(cache.get(key) || 0);
    if (sent >= SETTINGS.maxEmailsPerAddress) return false;
    cache.put(key, String(sent + 1), 6 * 60 * 60);

    var yes = reply.attending === 'Yes';
    MailApp.sendEmail({
      to: reply.email,
      subject: yes ? "You're on the list for Mark's 70th" : "Thanks for your RSVP to Mark's 70th",
      name: SETTINGS.senderName,
      htmlBody: confirmationHtml_(reply),
      body: confirmationText_(reply)
    });
    return true;
  } catch (err) {
    console.error('Confirmation email failed: ' + err);
    return false;
  }
}

function notifyHosts_(reply) {
  if (!SETTINGS.notifyEmails) return;
  try {
    var count = reply.guests.length;
    var subject = 'RSVP: ' + reply.guests[0].name + (count > 1 ? ' +' + (count - 1) : '') +
      (reply.attending === 'Yes' ? ' (attending)' : ' (not attending)');
    var lines = reply.guests.map(function (g) {
      return '- ' + g.name + (g.dietary ? ' (' + g.dietary + ')' : '');
    });
    var body = lines.join('\n') +
      (reply.email ? '\n\nEmail: ' + reply.email : '') +
      (reply.message ? '\n\nMessage:\n' + reply.message : '') +
      '\n\nAll replies: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl();
    MailApp.sendEmail(SETTINGS.notifyEmails, subject, body, { name: SETTINGS.senderName });
  } catch (err) {
    console.error('Host notification failed: ' + err);
  }
}

function confirmationHtml_(reply) {
  var yes = reply.attending === 'Yes';
  var first = esc_(reply.guests[0].name.split(' ')[0]);
  var guestList = reply.guests.map(function (g) {
    return '<li style="margin:0 0 6px;"><strong>' + esc_(g.name) + '</strong>' +
      (g.dietary ? ' <span style="color:#6b6a4a;">(' + esc_(g.dietary) + ')</span>' : '') + '</li>';
  }).join('');
  var button = 'display:inline-block;margin:0 8px 10px 0;padding:12px 18px;background:#5C6022;color:#ffffff;' +
    'text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px;letter-spacing:1px;';
  var link = 'color:#B8481A;font-weight:bold;';

  var intro = yes
    ? '<p style="margin:0 0 12px;">Thanks for your RSVP, ' + first + '. We can\'t wait to celebrate with you! Here\'s who we have down:</p>'
    : '<p style="margin:0 0 12px;">Thanks for letting us know, ' + first + '. We\'ll miss you! We\'ve noted that these guests can\'t make it:</p>';

  var details = yes
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;border-top:1px solid #d9c9a8;border-bottom:1px solid #d9c9a8;width:100%;">' +
        row_('When', esc_(EVENT.when)) +
        row_('Where', esc_(EVENT.venue) + '<br>' + esc_(EVENT.address) + '<br><span style="color:#6b6a4a;">' + esc_(EVENT.venueNote) + '</span>') +
        row_('Dress code', esc_(EVENT.dressCode)) +
        row_('Also', esc_(EVENT.details)) +
      '</table>' +
      '<p style="margin:0 0 6px;">' +
        '<a href="' + EVENT.googleCalendarUrl + '" style="' + button + '">Add to Google Calendar</a>' +
        '<a href="' + EVENT.icsUrl + '" style="' + button + '">Apple / Outlook calendar</a>' +
      '</p>' +
      '<p style="margin:0 0 16px;"><a href="' + EVENT.mapUrl + '" style="' + link + '">Open the map</a></p>'
    : '';

  return '' +
    '<div style="background:#5C6022;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="width:100%;max-width:560px;margin:0 auto;background:#FBEBD3;border-radius:12px;">' +
    '<tr><td style="padding:32px 28px;color:#2f3110;font-size:16px;line-height:1.5;">' +
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#B8481A;font-weight:bold;">' +
        (yes ? 'You\'re on the list' : 'RSVP received') + '</p>' +
      '<h1 style="margin:0 0 20px;font-size:26px;line-height:1.2;color:#5C6022;">' + esc_(EVENT.title) + '</h1>' +
      intro +
      '<ul style="margin:0 0 8px;padding-left:20px;">' + guestList + '</ul>' +
      details +
      '<p style="margin:0 0 16px;">Want to leave Mark a birthday message, or chip in for his present? ' +
        '<a href="' + EVENT.cardUrl + '" style="' + link + '">Sign his birthday card</a>.</p>' +
      '<p style="margin:0;font-size:14px;color:#6b6a4a;">Plans changed? Just RSVP again on the ' +
        '<a href="' + EVENT.siteUrl + '" style="color:#6b6a4a;">invitation page</a> and we\'ll use your latest reply.</p>' +
    '</td></tr></table></div>';
}

function confirmationText_(reply) {
  var yes = reply.attending === 'Yes';
  var first = reply.guests[0].name.split(' ')[0];
  var lines = reply.guests.map(function (g) {
    return '- ' + g.name + (g.dietary ? ' (' + g.dietary + ')' : '');
  }).join('\n');
  var text = yes
    ? 'Thanks for your RSVP, ' + first + ". We can't wait to celebrate with you! Here's who we have down:\n\n" + lines +
      '\n\nWhen: ' + EVENT.when +
      '\nWhere: ' + EVENT.venue + ', ' + EVENT.address + ' (' + EVENT.venueNote.toLowerCase() + ')' +
      '\nDress code: ' + EVENT.dressCode +
      '\n' + EVENT.details +
      '\n\nAdd to Google Calendar: ' + EVENT.googleCalendarUrl +
      '\nApple / Outlook calendar: ' + EVENT.icsUrl +
      '\nMap: ' + EVENT.mapUrl
    : 'Thanks for letting us know, ' + first + ". We'll miss you! We've noted that these guests can't make it:\n\n" + lines;
  return text +
    '\n\nWant to leave Mark a birthday message, or chip in for his present? ' + EVENT.cardUrl +
    "\n\nPlans changed? Just RSVP again at " + EVENT.siteUrl + " and we'll use your latest reply.";
}

function row_(label, value) {
  return '<tr><td style="padding:10px 12px 10px 0;vertical-align:top;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5C6022;font-weight:bold;white-space:nowrap;">' +
    label + '</td><td style="padding:10px 0;vertical-align:top;">' + value + '</td></tr>';
}

function nameKey_(name) {
  return String(name).toLowerCase().replace(/\s+/g, ' ').trim();
}

function oneLine_(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Stops text like "=SUM(...)" being treated as a formula in the sheet. */
function cell_(value) {
  value = String(value || '');
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function esc_(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
