# Riff

A local-first practice workspace for musicians: a score, a video lesson and an audio track side
by side on one page, on one machine, with no accounts and no network.

This glossary is the vocabulary the code, the commit messages, the issue tracker and the user
interface all use. Where two words exist for one thing, the one listed here is the one Riff uses.

## The workspace

**Pane**:
One of the three regions a musician practises from — Score, Video, Audio. A pane is a place, not
its contents: it exists whether or not anything is open in it.
_Avoid_: panel, tile, slot, widget

**Docked** / **Popped out**:
A pane is docked when it sits in the practice grid and popped out when it has a window of its
own. Every pane is one or the other.
_Avoid_: detached, undocked, floating, torn off

**Workspace**:
What is currently open in front of the musician — which score, and how it is being looked at.
_Avoid_: session (taken twice: a log session is one launch, a practice session is one line of
history), layout, workspace state

**Reopen offer**:
The one-time prompt at launch offering the workspace back as it was at last exit. Cleared from
disk at launch, so it is made exactly once whether or not it is answered.
_Avoid_: restore (taken twice: `nav.restore` is the un-maximise glyph, `general.restoreWindowState`
is window geometry), resume, session recovery

## Reading a score

**Score**:
The PDF a musician practises from, identified by where it lives on disk. A score is opened into
the Score pane; the pane is not the score.
_Avoid_: document (that is pdf.js's object, and the two get confused immediately), file, chart,
sheet, PDF

**View**:
How a score is currently being looked at — page, scale, rotation, spread, scroll mode and
auto-scroll speed. These six survive a pane popping out and come back with a reopen offer; whether
auto-scroll is running and whether a page is pinned are not among them and always start off.
_Avoid_: view state, viewport (pdf.js owns that word for something narrower), reading position

**Fit width** / **Fit page**:
Scaling a page so its width fills the pane, or so the whole page is visible. Both are recomputed
when the pane changes size, not only when the window does.
_Avoid_: zoom to fit, auto zoom, fit screen

**Spread**:
Two pages shown side by side, as a printed score opens.
_Avoid_: two-up, facing pages, dual page

**Page turn**:
Moving to the next or previous page as a single act, distinct from scrolling. It is bound to the
keys page-turner pedals send, which is why the two are not the same word.
_Avoid_: page change, next page (as a verb), advance

**Dim**:
How far the rendered page is darkened so a white score does not glare in a dark room. A magnitude,
not a mode, and independent of the theme.
_Avoid_: night mode, dark mode, invert (Riff does not render scores light-on-dark), high contrast

**Auto-scroll**:
The score advancing on its own at a pace the musician sets, in pages per minute. Started and
stopped deliberately, which is why reduced motion does not suppress it.
_Avoid_: autoplay, page turner, scrolling mode

**Smooth scroll**:
The animated movement when jumping to a page or a search hit. The only one of the two scrolls
that reduced motion suppresses.

**Pin**:
A constraint keeping auto-scroll on the current page — or in spread mode the current spread, since
you are reading both halves. It does not prevent scrolling by hand.
_Avoid_: lock, freeze, hold

## Files on disk

**Quarantine**:
Renaming a file aside, unread, because Riff could not understand it — never overwriting it.
It applies to files the user authored. Derived state is discarded and logged instead, because
quarantining it would leave litter the user never wrote.
_Avoid_: backup, recovery file
