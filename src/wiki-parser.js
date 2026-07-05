import DOMPurify from 'dompurify';
import {marked} from 'marked';

export function renderSlideContent(slide, assetResolver) {
    const raw = slide.contentText ?? '';
    const format = (slide.format || inferFormat(slide.contentPath)).toLowerCase();

    if (format === 'wm') {
        return sanitizeSlideHtml(renderWikiMarkup(raw, assetResolver));
    }

    const renderer = new marked.Renderer();
    renderer.image = ({href, title, text}) => {
        const safeHref = typeof href === 'string' ? href : '';
        const resolved = assetResolver(safeHref);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        const alt = escapeHtml(text || '');

        if (resolved instanceof Promise) {
            const assetPathAttr = ` data-sld-asset="${escapeHtml(safeHref)}"`;
            return `<img src="" alt="${alt}"${titleAttr}${assetPathAttr}>`;
        }

        return `<img src="${escapeHtml(resolved)}" alt="${alt}"${titleAttr}>`;
    };

    const rendered = marked.parse(raw, {renderer});
    const sanitizedHtml = sanitizeSlideHtml(rendered);
    const h5pContent = sanitizedHtml.replace(
        /<p>@@h5p:([A-Za-z0-9_-]+={0,2})@@<\/p>/g,
        (_, encodedUrl) => {
            const url = decodeBase64Url(encodedUrl);
            if (!url.startsWith('https://moodle.ki-campus.org/h5p/embed.php')) {
                return '';
            }
            return `
                <div class="h5p-frame">
                  <iframe
                    src="${url}"
                    loading="lazy"
                    allowfullscreen>
                  </iframe>
                </div>`;
        }
    );
    return h5pContent;
}

function decodeBase64Url(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return decodeURIComponent(
        atob(normalized)
            .split('')
            .map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
            .join('')
    );
}

function sanitizeSlideHtml(html) {
    return DOMPurify.sanitize(html, {
        USE_PROFILES: {html: true}
    });
}

export function inferFormat(path = '') {
    const normalized = path.toLowerCase();
    if (normalized.endsWith('.wm')) {
        return 'wm';
    }
    return 'md';
}

function renderWikiMarkup(input, assetResolver) {
    const lines = input.replace(/\r/g, '').split('\n');
    const blocks = [];
    let inList = false;

    const closeList = () => {
        if (inList) {
            blocks.push('</ul>');
            inList = false;
        }
    };

    for (const line of lines) {
        if (!line.trim()) {
            closeList();
            continue;
        }

        const heading = line.match(/^(=+)\s*(.*?)\s*\1$/);
        if (heading) {
            closeList();
            const level = Math.min(heading[1].length, 6);
            blocks.push(`<h${level}>${inlineWiki(heading[2], assetResolver)}</h${level}>`);
            continue;
        }

        if (line.startsWith('* ')) {
            if (!inList) {
                blocks.push('<ul>');
                inList = true;
            }
            blocks.push(`<li>${inlineWiki(line.slice(2), assetResolver)}</li>`);
            continue;
        }

        closeList();
        blocks.push(`<p>${inlineWiki(line, assetResolver)}</p>`);
    }

    closeList();
    return blocks.join('\n');
}

function inlineWiki(text, assetResolver) {
    return escapeHtml(text)
        .replace(/'''(.*?)'''/g, '<strong>$1</strong>')
        .replace(/''(.*?)''/g, '<em>$1</em>')
        .replace(/\[\[(.*?)\|(.*?)\]\]/g, (_, href, label) => `<a href="${assetResolver(href)}" target="_blank" rel="noreferrer">${label}</a>`)
        .replace(/\[\[(.*?)\]\]/g, (_, href) => `<a href="${assetResolver(href)}" target="_blank" rel="noreferrer">${href}</a>`);
}

function escapeHtml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
