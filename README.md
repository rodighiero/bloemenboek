# Bloemenboek — Agnes Block's flower album

A digital edition you can leaf through of *Plusieurs Especes de Fleurs dessinées d'apres le Naturel* (spine: *Bloemen na't leven gedaen*): the album of 196 flower drawings compiled by Agnes Block (1629–1704), c. 1680 – c. 1704. Artists named in the album include Maria Moninckx, Pieter Holsteyn II and Octavius M. de J. Rijksmuseum, Amsterdam, [RP-T-1948-119](https://www.rijksmuseum.nl/en/collection/RP-T-1948-119).

**Website:** https://rodighiero.github.io/bloemenboek/ (GitHub Pages, served from `docs/`)

## The website

A book lying on a sheet of hand-made paper, opened two pages at a time:

- turn pages by dragging or swiping, clicking a page, or with the arrow keys (Home/End jump to the start or end); moving the mouse near an outer edge lifts the corner;
- the turning leaf bends softly, is lit according to its angle, and casts a shadow on the page below;
- leather boards, page edges that grow and shrink as you read, a shadow that deepens under the spine, and gentle light across each page;
- page number and title under each page (linking to the Rijksmuseum record), a slider to jump anywhere, and a link per opening (`#12`);
- thumbnails load first; full-size images come from the Rijksmuseum's IIIF server, sized to the screen.

No build step and no dependencies: plain HTML, CSS and JavaScript. To preview locally:

```
cd docs && python3 -m http.server 8000
```

## Repository

| Path | Contents |
| --- | --- |
| `docs/index.html`, `style.css`, `app.js` | the website |
| `docs/pages.json` | page data for the site, made from `data/metadata.csv` |
| `docs/thumbs/` | 600 px thumbnails of all 198 images |
| `docs/paper.webp` | seamless paper texture for the background |
| `docs/fonts/` | Crimson Pro Light (SIL Open Font License) |
| `data/metadata.csv` | number, object number, title, IIIF id and URLs for all 198 records |
| `data/download.py` | downloads the full-resolution images to `data/images/`; `--pdf` also builds a PDF of the album |
| `tools/make_paper.py` | generates `docs/paper.webp` (needs numpy and Pillow) |

The full-resolution images (about 0.7 GB) and the PDF are not in the repository. Run `python3 data/download.py` to fetch the images; the PDF will be attached to a [release](https://github.com/rodighiero/bloemenboek/releases).

## What is digitised

The Rijksmuseum has 198 records for this album, one image each, all included here: the front cover, the inside front cover with the ex libris of Ernst H. Krelage (RP-T-1948-119-A), and sheets 1–196 (the title page is sheet 1). The album's handwritten index, its back cover and spine, and the backs of the sheets have not been digitised. Page titles are the Rijksmuseum's modern Dutch catalogue titles.

## Credits

Images: Rijksmuseum, Amsterdam, [Public Domain](https://creativecommons.org/publicdomain/mark/1.0/). Font: [Crimson Pro](https://github.com/Fonthausen/CrimsonPro), SIL Open Font License 1.1.
