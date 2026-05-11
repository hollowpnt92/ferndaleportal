/**
 * Visual site editor: drag-and-drop nav/pages, JSON save via fetch.
 */
(function () {
  "use strict";

  var dataEl = document.getElementById("admin-site-data");
  if (!dataEl) return;

  var site;
  try {
    site = JSON.parse(dataEl.textContent);
  } catch (e) {
    console.error(e);
    return;
  }

  var heroTitle = document.getElementById("field-hero-title");
  var heroSubtitle = document.getElementById("field-hero-subtitle");
  var homeContent = document.getElementById("field-home-content");
  var navList = document.getElementById("nav-links-list");
  var memberNavList = document.getElementById("member-nav-links-list");
  var pagesList = document.getElementById("pages-list");
  var btnSave = document.getElementById("btn-save-site");
  var btnPreview = document.getElementById("btn-preview-home");
  var toast = document.getElementById("admin-toast");
  var jsonPreview = document.getElementById("admin-json-preview");

  function showToast(message, isError) {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      toast.classList.remove("show");
    }, 3200);
  }

  function defaultLink() {
    return { label: "New link", path: "/", external: false };
  }

  function defaultPage() {
    return {
      slug: "new-page",
      title: "New page",
      content: "<p>Edit this content.</p>",
      memberOnly: false,
    };
  }

  function collectLinkFromRow(row) {
    var label = row.querySelector('[data-field="label"]');
    var path = row.querySelector('[data-field="path"]');
    var external = row.querySelector('[data-field="external"]');
    return {
      label: (label && label.value) || "Link",
      path: (path && path.value.trim()) || "/",
      external: Boolean(external && external.checked),
    };
  }

  function collectPageFromCard(card) {
    var slug = card.querySelector('[data-field="slug"]');
    var title = card.querySelector('[data-field="title"]');
    var content = card.querySelector('[data-field="content"]');
    var memberOnly = card.querySelector('[data-field="memberOnly"]');
    var out = {
      slug: (slug && slug.value.trim()) || "page",
      title: (title && title.value.trim()) || "Untitled",
      content: (content && content.value) || "",
    };
    if (memberOnly && memberOnly.checked) out.memberOnly = true;
    return out;
  }

  function buildNavRow(link, listEl) {
    var row = document.createElement("div");
    row.className = "sortable-item";
    row.innerHTML =
      '<button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
      '<circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="5" r="1.5"/>' +
      '<circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>' +
      '<circle cx="7" cy="15" r="1.5"/><circle cx="13" cy="15" r="1.5"/></svg></button>' +
      '<div class="item-fields">' +
      '<div class="nav-row-fields">' +
      '<div class="mini"><label>Label</label><input type="text" data-field="label" /></div>' +
      '<div class="mini"><label>URL or path</label><input type="text" data-field="path" placeholder="/p/about or https://…" /></div>' +
      '<div class="chk-row"><input type="checkbox" data-field="external" /><label>Opens in new tab (external)</label></div></div>' +
      '<div class="item-actions"><button type="button" class="btn-remove">Remove</button></div></div>';

    var chk = row.querySelector('[data-field="external"]');
    var chkLabel = row.querySelector(".chk-row label");
    if (chk && chkLabel) {
      var id = "ex-nav-" + Math.random().toString(36).slice(2);
      chk.id = id;
      chkLabel.setAttribute("for", id);
    }

    row.querySelector('[data-field="label"]').value = link.label || "";
    row.querySelector('[data-field="path"]').value = link.path || "";
    row.querySelector('[data-field="external"]').checked = !!link.external;

    row.querySelector(".btn-remove").addEventListener("click", function () {
      row.remove();
    });

    listEl.appendChild(row);
    return row;
  }

  function buildPageCard(page, listEl) {
    var card = document.createElement("div");
    card.className = "sortable-item page-card";
    card.innerHTML =
      '<button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
      '<circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="5" r="1.5"/>' +
      '<circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>' +
      '<circle cx="7" cy="15" r="1.5"/><circle cx="13" cy="15" r="1.5"/></svg></button>' +
      '<div class="item-fields">' +
      '<div class="page-head-row">' +
      '<div class="mini"><label>Slug (URL)</label><input type="text" data-field="slug" placeholder="about" /></div>' +
      '<div class="mini"><label>Page title</label><input type="text" data-field="title" /></div></div>' +
      '<div class="chk-row"><input type="checkbox" data-field="memberOnly" /><label>Members only</label></div>' +
      '<div class="page-content-area mini"><label>Page HTML</label><textarea data-field="content" rows="8"></textarea></div>' +
      '<div class="item-actions"><button type="button" class="btn-remove">Remove page</button></div></div>';

    var mem = card.querySelector('[data-field="memberOnly"]');
    var memLab = card.querySelector(".chk-row label");
    if (mem && memLab) {
      var mid = "mem-" + Math.random().toString(36).slice(2);
      mem.id = mid;
      memLab.setAttribute("for", mid);
    }

    card.querySelector('[data-field="slug"]').value = page.slug || "";
    card.querySelector('[data-field="title"]').value = page.title || "";
    card.querySelector('[data-field="content"]').value = page.content || "";
    card.querySelector('[data-field="memberOnly"]').checked = !!page.memberOnly;

    card.querySelector(".btn-remove").addEventListener("click", function () {
      card.remove();
    });

    listEl.appendChild(card);
    return card;
  }

  var homeSectionOrderList = document.getElementById("home-section-order-list");
  var HOME_SECTION_LABELS = {
    intro: "Introduction (homepage body)",
    calendar: "Events calendar",
    quick: "Quick link cards",
    poll: "Community poll",
  };
  var DEFAULT_HOME_SECTION_ORDER = ["intro", "calendar", "quick", "poll"];

  function buildHomeSectionRow(sectionKey, listEl) {
    var row = document.createElement("div");
    row.className = "sortable-item";
    row.dataset.sectionKey = sectionKey;
    row.innerHTML =
      '<button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">' +
      '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
      '<circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="5" r="1.5"/>' +
      '<circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>' +
      '<circle cx="7" cy="15" r="1.5"/><circle cx="13" cy="15" r="1.5"/></svg></button>' +
      '<div class="item-fields" style="flex:1;"><span class="home-section-label"></span></div>';
    row.querySelector(".home-section-label").textContent =
      HOME_SECTION_LABELS[sectionKey] || sectionKey;
    listEl.appendChild(row);
    return row;
  }

  function collectHomeSectionOrder() {
    if (!homeSectionOrderList) return DEFAULT_HOME_SECTION_ORDER.slice();
    var keys = [];
    homeSectionOrderList.querySelectorAll(".sortable-item").forEach(function (row) {
      var k = row.dataset.sectionKey;
      if (k) keys.push(k);
    });
    return keys.length ? keys : DEFAULT_HOME_SECTION_ORDER.slice();
  }

  function collectPayload() {
    var navRows = navList.querySelectorAll(".sortable-item");
    var memberRows = memberNavList.querySelectorAll(".sortable-item");
    var pageCards = pagesList.querySelectorAll(".sortable-item");

    var navLinks = [];
    navRows.forEach(function (row) {
      navLinks.push(collectLinkFromRow(row));
    });
    var memberNavLinks = [];
    memberRows.forEach(function (row) {
      memberNavLinks.push(collectLinkFromRow(row));
    });
    var pages = [];
    pageCards.forEach(function (card) {
      pages.push(collectPageFromCard(card));
    });

    return {
      heroTitle: (heroTitle && heroTitle.value.trim()) || site.heroTitle,
      heroSubtitle: (heroSubtitle && heroSubtitle.value) || "",
      homeContent: (homeContent && homeContent.value) || "",
      homeSectionOrder: collectHomeSectionOrder(),
      navLinks: navLinks,
      memberNavLinks: memberNavLinks,
      pages: pages,
    };
  }

  function updateJsonPreview() {
    if (!jsonPreview) return;
    try {
      jsonPreview.textContent = JSON.stringify(collectPayload(), null, 2);
    } catch (e) {
      jsonPreview.textContent = String(e);
    }
  }

  function initSortable(container) {
    if (typeof Sortable === "undefined" || !container) return;
    new Sortable(container, {
      animation: 180,
      handle: ".drag-handle",
      ghostClass: "sortable-ghost",
      dragClass: "sortable-drag",
      onEnd: updateJsonPreview,
    });
  }

  if (heroTitle) heroTitle.value = site.heroTitle || "";
  if (heroSubtitle) heroSubtitle.value = site.heroSubtitle || "";
  if (homeContent) homeContent.value = site.homeContent || "";

  var homeOrder = Array.isArray(site.homeSectionOrder) ? site.homeSectionOrder : DEFAULT_HOME_SECTION_ORDER;
  var allowedHome = { intro: 1, calendar: 1, quick: 1, poll: 1 };
  var seenH = {};
  if (homeSectionOrderList) {
    homeOrder.forEach(function (k) {
      if (!allowedHome[k] || seenH[k]) return;
      seenH[k] = true;
      buildHomeSectionRow(k, homeSectionOrderList);
    });
    DEFAULT_HOME_SECTION_ORDER.forEach(function (k) {
      if (!seenH[k]) buildHomeSectionRow(k, homeSectionOrderList);
    });
    if (typeof Sortable !== "undefined") {
      new Sortable(homeSectionOrderList, {
        animation: 180,
        handle: ".drag-handle",
        ghostClass: "sortable-ghost",
        dragClass: "sortable-drag",
        onEnd: updateJsonPreview,
      });
    }
  }

  (site.navLinks || []).forEach(function (link) {
    buildNavRow(link, navList);
  });
  (site.memberNavLinks || []).forEach(function (link) {
    buildNavRow(link, memberNavList);
  });
  (site.pages || []).forEach(function (page) {
    buildPageCard(page, pagesList);
  });

  initSortable(navList);
  initSortable(memberNavList);
  initSortable(pagesList);

  document.getElementById("btn-add-nav").addEventListener("click", function () {
    buildNavRow(defaultLink(), navList);
    updateJsonPreview();
  });
  document.getElementById("btn-add-member-nav").addEventListener("click", function () {
    buildNavRow(defaultLink(), memberNavList);
    updateJsonPreview();
  });
  document.getElementById("btn-add-page").addEventListener("click", function () {
    buildPageCard(defaultPage(), pagesList);
    updateJsonPreview();
  });

  [heroTitle, heroSubtitle, homeContent].forEach(function (field) {
    if (field) field.addEventListener("input", updateJsonPreview);
  });
  [navList, memberNavList, pagesList].forEach(function (list) {
    if (list) list.addEventListener("input", updateJsonPreview);
  });

  var advDetails = document.getElementById("admin-advanced-json");
  if (advDetails) {
    advDetails.addEventListener("toggle", function () {
      if (advDetails.open) updateJsonPreview();
    });
  }

  if (btnPreview) {
    btnPreview.addEventListener("click", function () {
      window.open("/", "_blank", "noopener,noreferrer");
    });
  }

  updateJsonPreview();

  if (btnSave) {
    btnSave.addEventListener("click", function () {
      var payload = collectPayload();
      btnSave.disabled = true;
      fetch("/admin/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.text().then(function (text) {
            var body = {};
            try {
              body = text ? JSON.parse(text) : {};
            } catch (e) {
              body = { error: text || "Invalid response" };
            }
            return { ok: res.ok, status: res.status, body: body };
          });
        })
        .then(function (result) {
          if (result.ok && result.body && result.body.ok) {
            site = payload;
            showToast("Saved successfully.");
          } else {
            var rawErr = result.body && result.body.error;
            var msg =
              typeof rawErr === "string" && rawErr.indexOf("<!DOCTYPE") !== -1
                ? "Session expired — refresh the page and sign in again."
                : rawErr || "Save failed (" + result.status + ").";
            showToast(String(msg).slice(0, 220), true);
          }
        })
        .catch(function () {
          showToast("Network error — could not save.", true);
        })
        .finally(function () {
          btnSave.disabled = false;
        });
    });
  }

  /* —— Homepage poll (same admin page) —— */
  var pollDataEl = document.getElementById("admin-poll-data");
  var pollList = document.getElementById("poll-options-admin-list");
  var fieldPollQuestion = document.getElementById("field-poll-question");
  var fieldPollClear = document.getElementById("field-poll-clear-votes");
  var btnSavePoll = document.getElementById("btn-save-poll");
  var btnAddPollOpt = document.getElementById("btn-add-poll-option");
  var votesListEl = document.getElementById("poll-votes-admin-list");
  var votesEmptyEl = document.getElementById("poll-votes-admin-empty");

  if (pollDataEl && pollList && fieldPollQuestion) {
    var pollState;
    try {
      pollState = JSON.parse(pollDataEl.textContent);
    } catch (e) {
      pollState = { question: "", options: [], votes: [] };
    }
    if (!Array.isArray(pollState.votes)) pollState.votes = [];

    function newPollOptionId() {
      if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return "opt-" + crypto.randomUUID();
      }
      return "opt-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    }

    function buildPollOptionRow(opt, listEl) {
      var row = document.createElement("div");
      row.className = "sortable-item";
      row.innerHTML =
        '<button type="button" class="drag-handle" aria-label="Drag to reorder" title="Drag to reorder">' +
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
        '<circle cx="7" cy="5" r="1.5"/><circle cx="13" cy="5" r="1.5"/>' +
        '<circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>' +
        '<circle cx="7" cy="15" r="1.5"/><circle cx="13" cy="15" r="1.5"/></svg></button>' +
        '<div class="item-fields">' +
        '<div class="nav-row-fields">' +
        '<div class="mini"><label>Choice ID</label><input type="text" data-poll-field="id" readonly class="poll-id-readonly" /></div>' +
        '<div class="mini"><label>Label</label><input type="text" data-poll-field="label" maxlength="200" /></div></div>' +
        '<div class="item-actions"><button type="button" class="btn-remove">Remove</button></div></div>';
      row.querySelector('[data-poll-field="id"]').value = opt.id || newPollOptionId();
      row.querySelector('[data-poll-field="label"]').value = opt.label || "";
      row.querySelector(".btn-remove").addEventListener("click", function () {
        row.remove();
      });
      listEl.appendChild(row);
      return row;
    }

    function collectPollPayload() {
      var rows = pollList.querySelectorAll(".sortable-item");
      var options = [];
      rows.forEach(function (row) {
        var idInp = row.querySelector('[data-poll-field="id"]');
        var labInp = row.querySelector('[data-poll-field="label"]');
        options.push({
          id: (idInp && idInp.value.trim()) || newPollOptionId(),
          label: (labInp && labInp.value.trim()) || "Choice",
        });
      });
      return {
        question: (fieldPollQuestion && fieldPollQuestion.value) || "",
        options: options,
        clearVotes: Boolean(fieldPollClear && fieldPollClear.checked),
      };
    }

    fieldPollQuestion.value = pollState.question || "";
    (pollState.options || []).forEach(function (o) {
      buildPollOptionRow(o, pollList);
    });

    function optionLabelForPoll(optionId) {
      var opts = pollState.options || [];
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].id === optionId) return opts[i].label;
      }
      return optionId;
    }

    function mergeVotesFromServer(votes) {
      if (Array.isArray(votes)) pollState.votes = votes;
    }

    function parseFetchBody(text) {
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        body = { error: text || "Invalid response" };
      }
      return body;
    }

    function renderVotesAdmin() {
      if (!votesListEl) return;
      votesListEl.innerHTML = "";
      var votes = pollState.votes.slice().sort(function (a, b) {
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      });
      if (votesEmptyEl) votesEmptyEl.style.display = votes.length ? "none" : "block";
      votes.forEach(function (v) {
        var row = document.createElement("div");
        row.className = "poll-vote-admin-row";
        row.dataset.voteId = v.id;
        var when = v.createdAt ? new Date(v.createdAt).toLocaleString() : "";
        row.innerHTML =
          '<div class="poll-vote-admin-meta">' +
          '<span class="poll-vote-admin-name"></span>' +
          '<span class="poll-vote-admin-sep">→</span>' +
          '<span class="poll-vote-admin-choice"></span>' +
          '<time class="poll-vote-admin-time"></time></div>' +
          '<button type="button" class="btn-remove poll-vote-remove">Remove vote</button>';
        row.querySelector(".poll-vote-admin-name").textContent = v.voterName || "";
        row.querySelector(".poll-vote-admin-choice").textContent = optionLabelForPoll(v.optionId);
        row.querySelector(".poll-vote-admin-time").textContent = when;
        row.querySelector(".poll-vote-remove").addEventListener("click", function () {
          var btn = row.querySelector(".poll-vote-remove");
          var vid = row.dataset.voteId;
          if (!vid || !btn) return;
          btn.disabled = true;
          fetch("/admin/poll/vote/delete", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "same-origin",
            body: JSON.stringify({ voteId: vid }),
          })
            .then(function (res) {
              return res.text().then(function (text) {
                return { ok: res.ok, status: res.status, body: parseFetchBody(text) };
              });
            })
            .then(function (result) {
              if (result.ok && result.body && result.body.ok) {
                mergeVotesFromServer(result.body.votes);
                renderVotesAdmin();
                showToast("Vote removed.");
              } else {
                var rawErr = result.body && result.body.error;
                showToast(String(rawErr || "Could not remove vote.").slice(0, 220), true);
                btn.disabled = false;
              }
            })
            .catch(function () {
              showToast("Network error — vote not removed.", true);
              btn.disabled = false;
            });
        });
        votesListEl.appendChild(row);
      });
    }

    renderVotesAdmin();

    if (typeof Sortable !== "undefined") {
      new Sortable(pollList, {
        animation: 180,
        handle: ".drag-handle",
        ghostClass: "sortable-ghost",
        dragClass: "sortable-drag",
      });
    }

    if (btnAddPollOpt) {
      btnAddPollOpt.addEventListener("click", function () {
        buildPollOptionRow({ id: newPollOptionId(), label: "New choice" }, pollList);
      });
    }

    if (btnSavePoll) {
      btnSavePoll.addEventListener("click", function () {
        var payload = collectPollPayload();
        btnSavePoll.disabled = true;
        fetch("/admin/poll/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        })
          .then(function (res) {
            return res.text().then(function (text) {
              return { ok: res.ok, status: res.status, body: parseFetchBody(text) };
            });
          })
          .then(function (result) {
            if (result.ok && result.body && result.body.ok) {
              if (fieldPollClear) fieldPollClear.checked = false;
              mergeVotesFromServer(result.body.votes);
              renderVotesAdmin();
              showToast("Poll saved.");
            } else {
              var rawErr = result.body && result.body.error;
              var msg =
                typeof rawErr === "string" && rawErr.indexOf("<!DOCTYPE") !== -1
                  ? "Session expired — refresh and sign in again."
                  : rawErr || "Poll save failed (" + result.status + ").";
              showToast(String(msg).slice(0, 220), true);
            }
          })
          .catch(function () {
            showToast("Network error — poll not saved.", true);
          })
          .finally(function () {
            btnSavePoll.disabled = false;
          });
      });
    }
  }
})();
