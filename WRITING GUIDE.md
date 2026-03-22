# Skadi – Writing Guide

## Three types of journal entries

Skadi has three distinct journal formats, each with its own voice, length and purpose. This guide covers the strategy and workflow for each.

---

## 1. Summit inline entries (column T, plain text)

These are short — one paragraph maximum. The constraint is a feature, not a limitation. It forces you to pick the one thing that made that summit memorable.

### Structure

1. One sentence on the conditions or the approach (sets the scene)
2. One sentence on the highlight or the specific memory
3. One sentence that lands with either humor, emotion, or a striking detail

### Keywords

Bold words emerge naturally from the writing. Do not force them. If a **chamois** crossed the path, bold it. If the **glacier** view was the main event, bold that. Keywords should be the nouns that carry the memory.

### Mindset

Write quickly, from memory, without overthinking. A summit entry that reads like a haiku beats a long description every time. The shortness is the point.

---

## 2. Summit Markdown entries (longer récits, journal/*.md)

For summits where something genuinely interesting happened: a technical route, a near-miss, a funny moment, a remarkable encounter.

### Workflow

1. **Draft first, edit second.** Write the whole thing without stopping. Do not correct as you go. The voice comes out better when you do not interrupt yourself.
2. **One strong opening line.** Not "Le 3 août nous avons décidé de..." but something that throws the reader directly into the action or the atmosphere.
3. **One technical section.** Grade, key passages, what made it challenging. Keep it brief, one paragraph.
4. **One human moment.** The anecdote, the detail that makes it yours and not a guidebook entry.
5. **One closing image.** End on something visual or sensory, not a conclusion.

### Keywords

Bold naturally as you write. They mark the moments that matter.

---

## 3. Bike journal Markdown entries (full travel narrative, journal/*.md)

The most creative format and the soul of the site. The dictaphone workflow is the recommended method — record the day in French, send the audio, get the Markdown back, review and adjust.

### Workflow

1. **Record the same evening or the next morning** while the details are fresh and the emotions are real. Do not wait a week.
2. **Describe in four beats:**
   - The morning start
   - One mid-day moment
   - One unexpected thing that happened
   - The end of the day
3. **Name the people.** Real names, real reactions, real dialogue if you remember any. It immediately makes the narrative alive.
4. **Do not over-describe the landscape.** One striking image per section is enough. What you felt matters more than what you saw.
5. **Bold keywords** should be nouns that carry the story: places, objects, sensations, nature elements. Not adjectives.
6. **Place photos where they add something the text does not already say.** A photo of a church needs less description around it. A photo of a night camp needs context.

### Recommended structure for a long étape entry

- Opening paragraph: tone and conditions of the day
- First photo: early in the narrative, floating right
- Middle section: the main event of the day (climb, encounter, discovery)
- Second photo: floating left, mid-narrative
- Technical or funny aside: one paragraph that shows personality
- Third photo: floating right, late narrative
- Final section: the end of the day, the camp, the mood
- Fourth photo: floating left, just before the closing line
- Closing line: short, punchy, sets up the next day without spelling it out

### Photo syntax (alternating float)

```html
<img src="journal/photos/TripName/EtapeN/filename.jpg" style="float: right; width: 45%; margin: 0 0 1.5em 1.5em; border-radius: 8px;" />

paragraph text here...

<div style="clear: both;"></div>

<img src="journal/photos/TripName/EtapeN/filename.jpg" style="float: left; width: 45%; margin: 0 1.5em 1.5em 0; border-radius: 8px;" />

paragraph text here...

<div style="clear: both;"></div>
```

---

## General advice across all three formats

Write in the same voice you use on Instagram: the one that does not take itself too seriously. The moment the writing becomes formal or guidebook-like, it loses what makes Skadi different from CampToCamp.

Your readers are your friends and their friends. They want to feel like they are hearing about the trip from you directly, not reading a report.

---

## Dictaphone workflow (bike tab)

1. Open Voice Memos on Mac or iPhone
2. Record your story in French, describing the day in the four beats above
3. Use macOS transcription (right-click recording in Voice Memos → Transcribe) or send the audio file directly
4. Share the transcription or audio along with the photos for the étape
5. Receive the formatted Markdown with photos integrated
6. Review, adjust tone if needed, save to `journal/` and push to GitHub

Total time per étape: approximately 15 minutes of talking and a quick review pass.