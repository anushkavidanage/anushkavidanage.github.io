/*
 * Norra's join page: shows the outline of a trip someone was invited to,
 * read straight from the organiser's Solid Pod, and explains how to join.
 *
 * The link looks like  .../join/?invite=<url of the invite preview>
 * The preview is a public JSON-LD document Norra writes
 * (lib/sharing/invite.dart). Nothing here is sent anywhere else.
 *
 * Pure functions are exported for tests (site/join/join.test.mjs).
 */
(function () {
  'use strict';

  /** Where Norra can be downloaded. */
  var DOWNLOAD_URL = 'https://solidcommunity.au/installers/';

  /**
   * The hosted Norra web app, once there is one (e.g.
   * 'https://norra.solidcommunity.au/'). Empty: the "open in your browser"
   * option is hidden.
   */
  var WEB_APP_URL = '';

  var KINDS = {
    flight: ['Flight', 'Flights', '✈'],
    transport: ['Transport', 'Transport', '🚆'],
    stay: ['Stay', 'Stays', '🏨'],
    place: ['Place', 'Places', '📍'],
    car: ['Car rental', 'Car rentals', '🚗'],
    food: ['Restaurant', 'Restaurants', '🍽'],
    event: ['Activity', 'Activities', '🎟'],
    note: ['Note', 'Notes', '🗒'],
  };

  // Same gradients and hash as the app (NorraPalette.coverFor), so a trip
  // looks the same here as in Norra.
  var COVERS = [
    ['#0F766E', '#134E4A'],
    ['#F97360', '#E0533F'],
    ['#14B8A6', '#0F766E'],
    ['#334155', '#17202A'],
    ['#0F766E', '#F97360'],
  ];

  function coverFor(tripId) {
    var hash = 0;
    for (var i = 0; i < tripId.length; i++) {
      hash = (hash * 31 + tripId.charCodeAt(i)) & 0x7fffffff;
    }
    return COVERS[hash % COVERS.length];
  }

  /** The preview URL from the page's query string, or null. */
  function previewUrlFrom(search) {
    var params = new URLSearchParams(search);
    var raw = params.get('invite');
    if (!raw) return null;
    try {
      var url = new URL(raw);
      if (url.protocol !== 'https:' || !url.pathname.endsWith('.jsonld')) {
        return null;
      }
      return url.toString();
    } catch (e) {
      return null;
    }
  }

  // --- A tolerant JSON-LD reader (compact, expanded or @graph) ---------

  function nodesOf(doc) {
    if (Array.isArray(doc)) return doc;
    if (doc && Array.isArray(doc['@graph'])) return doc['@graph'];
    return [doc];
  }

  function typesOf(node) {
    var t = node && node['@type'];
    var list = Array.isArray(t) ? t : [t];
    return list
      .filter(function (x) { return typeof x === 'string'; })
      .map(function (x) { return x.split(/[/#:]/).pop(); });
  }

  function values(node, key) {
    var keys = [key, 'schema:' + key, 'https://schema.org/' + key,
      'http://schema.org/' + key];
    for (var i = 0; i < keys.length; i++) {
      if (node && Object.prototype.hasOwnProperty.call(node, keys[i])) {
        var v = node[keys[i]];
        return Array.isArray(v) ? v : [v];
      }
    }
    return [];
  }

  function resolver(all) {
    return function (value) {
      if (value && typeof value === 'object' && Object.keys(value).length === 1 &&
          typeof value['@id'] === 'string') {
        for (var i = 0; i < all.length; i++) {
          if (all[i] && all[i]['@id'] === value['@id']) return all[i];
        }
      }
      return value;
    };
  }

  function text(node, key) {
    var vs = values(node, key);
    for (var i = 0; i < vs.length; i++) {
      var raw = vs[i] && typeof vs[i] === 'object' ? vs[i]['@value'] : vs[i];
      if (typeof raw === 'string' || typeof raw === 'number') return String(raw);
    }
    return null;
  }

  /** The invite in a preview document, or throws. */
  function parseInvite(json) {
    var all = nodesOf(json);
    var resolve = resolver(all);
    var invite = all.find(function (n) {
      return typesOf(n).indexOf('InviteAction') !== -1;
    });
    if (!invite) throw new Error('Not a Norra invite');
    var agent = resolve(values(invite, 'agent')[0]) || {};
    var trip = resolve(values(invite, 'object')[0]);
    if (!trip || typeof trip !== 'object') throw new Error('Incomplete invite');

    var places = values(trip, 'itinerary').map(resolve)
      .map(function (p) { return text(p, 'name'); })
      .filter(Boolean);
    var counts = values(trip, 'additionalProperty').map(resolve)
      .map(function (p) {
        return { id: text(p, 'propertyID'), value: Number(text(p, 'value')) };
      })
      .filter(function (c) { return KINDS[c.id] && c.value > 0; });

    return {
      organiserWebId: typeof agent['@id'] === 'string' ? agent['@id'] : null,
      organiserName: text(agent, 'name'),
      tripId: text(trip, 'identifier') || '',
      name: text(trip, 'name') || 'A trip',
      start: text(trip, 'departureTime'),
      end: text(trip, 'arrivalTime'),
      places: places,
      counts: counts,
      expiresAt: text(invite, 'endTime'),
    };
  }

  /** Whether the invite's link has passed its end time. */
  function hasExpired(invite, now) {
    if (!invite.expiresAt) return false;
    var end = new Date(invite.expiresAt);
    return !isNaN(end) && end < (now || new Date());
  }

  /** "sam.solidcommunity.au" from a WebID. */
  function shortWebId(webId) {
    try {
      var url = new URL(webId);
      var path = url.pathname.replace(/\/profile\/card$/, '').replace(/\/$/, '');
      return url.host + path;
    } catch (e) {
      return webId || 'Someone';
    }
  }

  function organiserLabel(invite) {
    return invite.organiserName || shortWebId(invite.organiserWebId);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec'];

  function day(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  }

  /** "1 – 5 Oct 2026", like the app's formatDateRange. */
  function formatDates(startIso, endIso) {
    var a = day(startIso || endIso);
    var b = day(endIso || startIso);
    if (!a || !b) return '';
    var full = function (x) { return x.d + ' ' + MONTHS[x.m] + ' ' + x.y; };
    if (a.y === b.y && a.m === b.m && a.d === b.d) return full(a);
    if (a.y === b.y && a.m === b.m) return a.d + ' – ' + full(b);
    if (a.y === b.y) return a.d + ' ' + MONTHS[a.m] + ' – ' + full(b);
    return full(a) + ' – ' + full(b);
  }

  function countLabel(c) {
    var k = KINDS[c.id];
    return c.value + ' ' + (c.value === 1 ? k[0] : k[1]);
  }

  // --- The page --------------------------------------------------------

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  function showMessage(title, message) {
    var main = document.getElementById('content');
    main.replaceChildren(el('section', { class: 'card message' }, [
      el('h1', { text: title }),
      el('p', { text: message }),
    ]));
  }

  function render(invite, previewUrl) {
    var who = organiserLabel(invite);
    var cover = coverFor(invite.tripId);
    var main = document.getElementById('content');
    document.title = invite.name + ' · Norra';

    var header = el('div', { class: 'cover' }, [
      el('p', { class: 'eyebrow', text: who + ' invited you to' }),
      el('h1', { text: invite.name }),
      el('p', { class: 'dates', text: formatDates(invite.start, invite.end) }),
    ]);
    header.style.background =
      'linear-gradient(135deg, ' + cover[0] + ', ' + cover[1] + ')';

    var body = el('div', { class: 'body' }, [
      invite.places.length
        ? el('ul', { class: 'places', 'aria-label': 'Places' },
          invite.places.map(function (p) { return el('li', { text: p }); }))
        : null,
      invite.counts.length
        ? el('ul', { class: 'counts', 'aria-label': 'Plans' },
          invite.counts.map(function (c) {
            return el('li', {}, [
              el('span', { class: 'icon', 'aria-hidden': 'true', text: KINDS[c.id][2] }),
              el('span', { text: countLabel(c) }),
            ]);
          }))
        : null,
      el('p', {
        class: 'muted',
        text: 'The full itinerary stays private in ' + who +
          '’s own storage until they let you in.',
      }),
      el('button', { id: 'join', class: 'primary', type: 'button', text: 'Join this trip' }),
    ]);

    var copyButton = el('button', { class: 'secondary', type: 'button', text: 'Copy invite link' });
    var copied = el('span', { class: 'copied', role: 'status' });
    var steps = el('section', { id: 'steps', class: 'card steps', hidden: '' }, [
      el('h2', { text: 'How to join' }),
      el('ol', {}, [
        el('li', {}, [
          el('strong', { text: 'Get Norra. ' }),
          el('span', { text: 'It’s free, with no subscription. ' }),
          el('a', { href: DOWNLOAD_URL, target: '_blank', rel: 'noopener', text: 'Download Norra' }),
          WEB_APP_URL
            ? el('span', {}, [
              el('span', { text: ' or ' }),
              el('a', {
                href: WEB_APP_URL + '?invite=' + encodeURIComponent(previewUrl),
                text: 'open it in your browser',
              }),
            ])
            : null,
        ]),
        el('li', {}, [
          el('strong', { text: 'Sign in, or choose Register. ' }),
          el('span', {
            text: 'Registering creates your free Pod – storage you own, ' +
              'where your trips live instead of on someone’s servers.',
          }),
        ]),
        el('li', {}, [
          el('strong', { text: 'Open “Join a trip” in Norra’s menu ' }),
          el('span', { text: 'and paste this invite link. ' }),
          copyButton,
          copied,
        ]),
        el('li', {}, [
          el('strong', { text: who + ' lets you in. ' }),
          el('span', { text: 'They’ll see your request the next time they open Norra.' }),
        ]),
      ]),
    ]);

    main.replaceChildren(el('section', { class: 'card invite' }, [header, body]), steps);

    function copyLink() {
      var done = function () { copied.textContent = 'Copied'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(location.href).then(done, function () {
          copied.textContent = 'Copy the address from your browser’s address bar';
        });
      } else {
        copied.textContent = 'Copy the address from your browser’s address bar';
      }
    }
    copyButton.addEventListener('click', copyLink);
    document.getElementById('join').addEventListener('click', function () {
      steps.hidden = false;
      copyLink();
      steps.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function start() {
    var previewUrl = previewUrlFrom(location.search);
    if (!previewUrl) {
      showMessage('This link is incomplete',
        'Ask the person who invited you to send the link again.');
      return;
    }
    fetch(previewUrl, {
      headers: { Accept: 'application/ld+json, application/json;q=0.9' },
      credentials: 'omit',
    })
      .then(function (response) {
        if (response.status === 404 || response.status === 401 ||
            response.status === 403) {
          throw Object.assign(new Error('gone'), { gone: true });
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (json) {
        var invite = parseInvite(json);
        if (hasExpired(invite)) {
          showMessage('This invite has ended',
            'Ask ' + organiserLabel(invite) + ' for a new link.');
          return;
        }
        render(invite, previewUrl);
      })
      .catch(function (error) {
        if (error && error.gone) {
          showMessage('This invite has ended',
            'The organiser turned this link off. Ask them for a new one.');
        } else {
          showMessage('Couldn’t load this invite',
            'Check your connection and try again. If it keeps happening, ' +
            'ask the person who invited you for a new link.');
        }
      });
  }

  var api = {
    previewUrlFrom: previewUrlFrom,
    parseInvite: parseInvite,
    hasExpired: hasExpired,
    shortWebId: shortWebId,
    formatDates: formatDates,
    coverFor: coverFor,
    countLabel: countLabel,
  };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    document.addEventListener('DOMContentLoaded', start);
  }
})();
