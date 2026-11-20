# Swahili review package · Karibu

Hi, and thank you. You are the first native reviewer to volunteer
for any of NIDO's language campaigns, so Swahili is next in line
to ship.

## What NIDO is

NIDO is a free, open source personal assistant that runs entirely
on the phone: no accounts, no servers, nothing leaves the device.
It is built for people whose phone is modest and whose connection
may not exist at all. Your review decides how NIDO will speak
Swahili to them.

## What is in this package

A machine draft of everything NIDO says in English, so you never
face a blank page. **1,566 entries** in this first delivery:

- `03-seguridad.md` — **Safety, 117 entries. Read this one first.**
  The fixed texts NIDO shows when someone may be in danger:
  carbon monoxide, self-harm, emergency numbers, the spoken CPR
  guide. Some are marked ⚠ CRITICAL.
- `01-ui-*.md` — **The interface, 1,307 entries in 10 files**,
  one per area of the app (chat, settings, models, packs, memory,
  and so on). Each file is one review session.
- `02-conversacional.md` — **The conversational layer, 142
  entries**: the assistant's fixed phrases (confirmations,
  greetings, answers about what it remembers).

A second delivery will bring the long content (the guides) and
the license texts. Nothing else is hidden: this is the whole
spoken and written surface of the app.

## How to review

Each entry looks like this:

### `chatScreen.sendButton`
- **EN:** Send
- **SW (machine draft, please correct it):** Tuma
- **Your correction:** *(write here only if you change something)*
- **Note:** *(tone, context, questions)*

- If the draft is right, leave it empty. Empty means "this one
  is good as it stands".
- If it is wrong, or just sounds off, write your version in
  **Your correction**. Your wording wins, always. You grew up
  with the language; the draft did not.
- Use **Note** for anything you want us to know: "nobody says it
  like this in Kenya", "this word is fine in Tanzania but not
  here", doubts, alternatives.

You can edit the files right here on GitHub (the pencil icon on
any file), or in a fork, or paste corrections into issue #106,
whatever is easiest for you. There is no deadline and no order
requirement, although safety first helps most.

## Golden rules

1. **What is inside {{ }} never changes.** Things like `{{name}}`
   or `{{count}}` are placeholders the app fills in. Do not
   translate them, rename them or drop them.
2. **Emergency numbers never change.** 911, 112, 988 and the
   rest are data, checked against official sources. If a number
   looks wrong for a country you know, tell us in a Note and we
   will check the source; please do not edit the digits.
3. **Your tone is the tone.** Formal or familiar, one word or
   another: your call. When you make a choice that should stick
   everywhere (a word for "backup", say, or how NIDO addresses
   the user), add it to `glosario.md` in this same folder, or
   mention it in a Note and we will.
4. **Safety texts: clear beats elegant.** When someone may be
   in danger, short and direct is the right style, even if it
   sounds plain.

## One honest limit

This package translates what NIDO *says*. Teaching NIDO to
*understand* a written emergency in Swahili (the word lists its
safety gate reads) is a separate, later step, and we will not
pretend otherwise. If you are up for it when this review is done,
that list of "how people actually write it" would be the next
gift, and we will ask properly then.

Asante sana.
