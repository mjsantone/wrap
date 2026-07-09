'use strict';

const { app } = require('@azure/functions');
const { validateStory, newId, ID_PATTERN, MAX_BODY_BYTES } = require('../lib/story');
const { getContainer } = require('../lib/cosmos');

function json(status, body) {
  return { status, jsonBody: body };
}

/* POST /api/books  { story: {...} }  →  201 { id }
 * Stores a validated story as an unlisted document. Share links are
 * /b/{id}; nothing is listed publicly (the gallery is a later phase). */
app.http('books-create', {
  route: 'books',
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY_BYTES * 2) return json(413, { error: 'payload too large' });

    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'request body must be JSON' });
    }

    const result = validateStory(body && body.story);
    if (!result.ok) return json(400, { error: result.error });

    const doc = {
      id: newId(),
      formatVersion: 1,
      visibility: 'unlisted',
      story: result.story,
      createdAt: new Date().toISOString(),
    };
    await getContainer().items.create(doc);
    context.log(`book stored id=${doc.id} cards=${result.story.cards.length}`);
    return json(201, { id: doc.id });
  },
});

/* GET /api/books/{id}  →  200 { id, formatVersion, story, createdAt } */
app.http('books-get', {
  route: 'books/{id}',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const id = request.params.id || '';
    if (!ID_PATTERN.test(id)) return json(400, { error: 'malformed book id' });

    try {
      const { resource } = await getContainer().item(id, id).read();
      if (!resource) return json(404, { error: 'book not found' });
      return json(200, {
        id: resource.id,
        formatVersion: resource.formatVersion,
        story: resource.story,
        createdAt: resource.createdAt,
      });
    } catch (err) {
      if (err && err.code === 404) return json(404, { error: 'book not found' });
      throw err;
    }
  },
});
