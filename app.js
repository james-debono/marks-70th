/* Mark's 70th Birthday: invitation page behaviour.
   Plain ES2015-era JavaScript on purpose, so it works on older phones and tablets. */
(function () {
  'use strict';

  // Google Apps Script web app that saves each RSVP to the "Mark's 70th RSVPs" Google Sheet.
  var RSVP_ENDPOINT = 'https://script.google.com/macros/s/AKfycbyJy38ahg20k0S9P4rZPBZq69aeMoHnBreOjJdyTOOsS41bodVJq6K8sxLamA7SAndTOg/exec';
  var MAX_GUESTS = 12;
  var STORAGE_KEY = 'marks70th-rsvp';
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var GENERIC_ERROR = "Sorry, your RSVP didn't go through. Please check your internet connection and try again. " +
    'If it keeps happening, let whoever sent you this invitation know.';

  function $(id) { return document.getElementById(id); }
  function each(list, fn) { Array.prototype.forEach.call(list, fn); }
  function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }

  /* ---------- Card reveal ---------- */

  var hero = document.querySelector('.hero');
  var card = $('invite-card');
  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    hero.className += ' is-revealed';
  }
  if (card.complete) {
    setTimeout(reveal, 80);
  } else {
    card.addEventListener('load', function () { setTimeout(reveal, 40); });
    card.addEventListener('error', reveal);
  }
  setTimeout(reveal, 3500);

  /* ---------- Calendar menus: close when tapping elsewhere ---------- */

  document.addEventListener('click', function (event) {
    each(document.querySelectorAll('details.calendar[open]'), function (menu) {
      if (!menu.contains(event.target)) menu.removeAttribute('open');
    });
  });
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' && event.key !== 'Esc') return;
    each(document.querySelectorAll('details.calendar[open]'), function (menu) {
      menu.removeAttribute('open');
      var summary = menu.querySelector('summary');
      if (summary) summary.focus();
    });
  });

  /* ---------- RSVP ---------- */

  var choiceButtons = document.querySelectorAll('[data-attend]');
  var panel = $('rsvp-panel');
  var form = $('rsvp-form');
  var guestsEl = $('guests');
  var template = $('guest-template');
  var addButton = $('add-guest');
  var errorEl = $('form-error');
  var submitButton = $('submit');
  var done = $('rsvp-done');

  var attending = null; // 'yes' or 'no'
  var replyId = null;   // reused if a send is retried, so a reply is never saved twice
  var sending = false;
  var warmedUp = false;

  each(choiceButtons, function (button) {
    button.addEventListener('click', function () {
      choose(button.getAttribute('data-attend'));
    });
  });

  addButton.addEventListener('click', function () { addGuest(true); });
  form.addEventListener('submit', onSubmit);
  $('rsvp-again').addEventListener('click', function () {
    showForm();
    focusFirstName();
  });

  showPrevious(recall());

  function choose(value) {
    attending = value;
    var yes = value === 'yes';
    each(choiceButtons, function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-attend') === value));
    });
    form.className = 'rsvp-form ' + (yes ? 'is-attending' : 'is-declining');
    $('form-heading').textContent = yes ? "Who's coming?" : "Sorry you can't make it";
    $('form-hint').textContent = yes
      ? "Add everyone in your group who'll be there, with any dietary requirements."
      : "Let us know who's replying, so we can tick you off the list.";
    $('message-label').firstChild.nodeValue = yes ? 'Anything else we should know? ' : 'A note for the hosts ';
    $('email-hint').textContent = yes ? "We'll send you a copy of your RSVP." : "We'll send you a copy of your reply.";
    addButton.textContent = yes ? '+ Add another guest' : '+ Add another name';

    if (!guestsEl.children.length) addGuest(false);
    each(guestsEl.querySelectorAll('input[name="dietary"]'), function (input) { input.disabled = !yes; });
    renumber();
    showForm();
    warmUp();
    focusFirstName();
  }

  function showForm() {
    hideError();
    replyId = null;
    panel.hidden = false;
    form.hidden = false;
    done.hidden = true;
  }

  function focusFirstName() {
    var input = guestsEl.querySelector('input[name="name"]');
    if (!input) return;
    scrollToPanel();
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }

  function scrollToPanel() {
    var top = panel.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { panel.scrollIntoView(true); }
    }
  }

  function addGuest(focus) {
    if (guestsEl.children.length >= MAX_GUESTS) return;
    var fragment = document.importNode(template.content, true);
    var row = fragment.querySelector('.guest');
    var nameInput = row.querySelector('input[name="name"]');
    var dietaryInput = row.querySelector('input[name="dietary"]');
    // Let the browser fill in the first name only; later rows are other people.
    nameInput.setAttribute('autocomplete', guestsEl.children.length ? 'off' : 'name');
    dietaryInput.disabled = attending !== 'yes';
    row.querySelector('.guest__remove').addEventListener('click', function () { removeGuest(row); });
    guestsEl.appendChild(row);
    renumber();
    if (focus) nameInput.focus();
  }

  function removeGuest(row) {
    var neighbour = row.previousElementSibling || row.nextElementSibling;
    guestsEl.removeChild(row);
    renumber();
    if (neighbour) neighbour.querySelector('input[name="name"]').focus();
  }

  function renumber() {
    var rows = guestsEl.children;
    var word = attending === 'no' ? 'Name ' : 'Guest ';
    for (var i = 0; i < rows.length; i++) {
      var label = word + (i + 1);
      rows[i].querySelector('.guest__legend').textContent = label;
      var remove = rows[i].querySelector('.guest__remove');
      remove.hidden = rows.length === 1;
      remove.setAttribute('aria-label', 'Remove ' + label);
    }
    addButton.hidden = rows.length >= MAX_GUESTS;
  }

  function onSubmit(event) {
    event.preventDefault();
    if (sending || !attending) return;
    hideError();

    var guests = [];
    var nameMissing = null;
    each(guestsEl.children, function (row) {
      var nameInput = row.querySelector('input[name="name"]');
      var name = clean(nameInput.value);
      var dietary = attending === 'yes' ? clean(row.querySelector('input[name="dietary"]').value) : '';
      nameInput.removeAttribute('aria-invalid');
      if (name) guests.push({ name: name, dietary: dietary });
      else if (dietary && !nameMissing) nameMissing = nameInput;
    });

    if (!guests.length) {
      var first = guestsEl.querySelector('input[name="name"]');
      first.setAttribute('aria-invalid', 'true');
      return showError('Please enter at least one name.', first);
    }
    if (nameMissing) {
      nameMissing.setAttribute('aria-invalid', 'true');
      return showError('Please add a name for each guest, or remove the empty row.', nameMissing);
    }

    var emailInput = form.elements.email;
    var email = clean(emailInput.value);
    emailInput.removeAttribute('aria-invalid');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailInput.setAttribute('aria-invalid', 'true');
      return showError("That email address doesn't look right. Please check it, or leave it blank.", emailInput);
    }

    if (!replyId) replyId = makeId();
    var payload = {
      attending: attending,
      guests: guests,
      email: email,
      message: String(form.elements.message.value || '').trim(),
      website: form.elements.website.value,
      replyId: replyId
    };

    setSending(true);
    send(payload).then(function (result) {
      setSending(false);
      remember(payload);
      showDone(payload, result);
    }, function (error) {
      setSending(false);
      showError((error && error.userMessage) || GENERIC_ERROR);
    });
  }

  function send(payload) {
    return new Promise(function (resolve, reject) {
      if (!RSVP_ENDPOINT) {
        reject(withMessage('RSVPs aren’t open yet. Please try again later.'));
        return;
      }
      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var finished = false;
      var timer = setTimeout(function () {
        if (finished) return;
        finished = true;
        if (controller) controller.abort();
        reject(withMessage('This is taking longer than usual. Please check your connection and press Send RSVP again. ' +
          "(If your first try did get through, we'll only count it once.)"));
      }, 30000);

      // Sent as plain text so the browser doesn't need a CORS preflight; the script parses the JSON.
      fetch(RSVP_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(payload),
        credentials: 'omit',
        signal: controller ? controller.signal : undefined
      }).then(function (response) {
        return response.json();
      }).then(function (data) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (data && data.ok) resolve(data);
        else reject(withMessage(data && data.error));
      }).catch(function (error) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function withMessage(message) {
    var error = new Error(message || 'RSVP failed');
    error.userMessage = message || null;
    return error;
  }

  function warmUp() {
    // Google's script can take a few seconds to wake up; nudge it while the guest types.
    if (warmedUp || !RSVP_ENDPOINT || typeof fetch !== 'function') return;
    warmedUp = true;
    fetch(RSVP_ENDPOINT, { credentials: 'omit' }).catch(function () {});
  }

  function setSending(on) {
    sending = on;
    submitButton.disabled = on;
    submitButton.textContent = on ? 'Sending…' : 'Send RSVP';
    form.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function showError(message, focusEl) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    if (focusEl) focusEl.focus();
  }

  function hideError() {
    errorEl.hidden = true;
    errorEl.textContent = '';
  }

  function showDone(payload, result) {
    var yes = payload.attending === 'yes';
    var firstName = payload.guests[0].name.split(' ')[0];
    var several = payload.guests.length > 1;

    $('done-heading').textContent = yes ? "You're on the list!" : 'Thanks for letting us know';
    $('done-intro').textContent = yes
      ? 'Thanks, ' + firstName + ". We can't wait to celebrate with you. Here's who we have down:"
      : "We'll miss you, " + firstName + '. ' +
        (several ? "We've noted that these guests can't make it:" : "We've noted that you can't make it.");
    $('done-outro').hidden = yes;

    var list = $('done-list');
    list.innerHTML = '';
    list.className = 'rsvp-done__list' + (yes ? '' : ' is-declined');
    list.hidden = !yes && !several;
    payload.guests.forEach(function (guest) {
      var item = document.createElement('li');
      item.textContent = guest.name + (guest.dietary ? ' (' + guest.dietary + ')' : '');
      list.appendChild(item);
    });

    var emailLine = $('done-email');
    emailLine.hidden = !(result && result.emailed);
    emailLine.textContent = result && result.emailed ? "We've emailed a copy to " + payload.email + '.' : '';

    $('done-actions-yes').hidden = !yes;
    $('done-actions-no').hidden = yes;

    form.hidden = true;
    done.hidden = false;
    replyId = null;
    showPrevious(recall());
    try { done.focus({ preventScroll: true }); } catch (e) { done.focus(); }
    scrollToPanel();
  }

  /* Remember this reply on this device only, so a returning guest sees what they sent. */

  function remember(payload) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        attending: payload.attending,
        count: payload.guests.length,
        at: Date.now()
      }));
    } catch (e) { /* private browsing or storage blocked: not needed for the RSVP itself */ }
  }

  function recall() {
    try {
      var saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && saved.at ? saved : null;
    } catch (e) {
      return null;
    }
  }

  function showPrevious(saved) {
    var note = $('rsvp-previous');
    if (!saved) { note.hidden = true; return; }
    var date = new Date(saved.at);
    var people = saved.count > 1 ? ', ' + saved.count + ' people' : '';
    note.textContent = 'You replied on ' + date.getDate() + ' ' + MONTHS[date.getMonth()] +
      ' (' + (saved.attending === 'yes' ? 'attending' : 'not attending') + people + '). Plans changed? Just reply again.';
    note.hidden = false;
  }

  function makeId() {
    var cryptoObj = window.crypto || window.msCrypto;
    var random = '';
    if (cryptoObj && cryptoObj.getRandomValues) {
      var bytes = new Uint8Array(8);
      cryptoObj.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) random += ('0' + bytes[i].toString(16)).slice(-2);
    } else {
      random = Math.random().toString(16).slice(2, 18);
    }
    return Date.now().toString(36) + '-' + random;
  }
})();
