---
title: Working with AI
description: Install Deckup skills for AI coding agents and start creating presentations with example prompts.
---

Deckup provides skills for AI coding agents, enabling them to understand Deckup's syntax, layouts, themes, build commands, and visual review workflow.

## Install the skills

Install the Deckup skills with [`skills`](https://skills.sh/):

```bash
npx skills add yukukotani/deckup
```

The installer detects the supported coding agents on your machine and lets you choose which Deckup skills to install.

- `use-deckup` helps agents create, edit, preview, visually review, and export presentations.
- `create-deckup-theme` helps agents build and verify reusable theme packages.

The skill source is available in the repository's [`.agents/skills`](https://github.com/yukukotani/deckup/tree/main/.agents/skills) directory.

## Example prompts

Once the skills are installed, ask your coding agent to work directly on a Deckup project:

> Create a five-slide presentation that introduces this project using its README.

> Add an agenda slide after the cover.

> Make slide 3 shorter and easier to read.

> Change this deck to the `minimal` theme and render it to PNG.

> Check every slide for visual problems, fix them, and export the deck as a PDF.
