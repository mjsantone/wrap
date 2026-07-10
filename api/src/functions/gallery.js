'use strict';

const { app } = require('@azure/functions');
const { getContainer } = require('../lib/cosmos');

function json(status, body) {
  return { status, jsonBody: body };
}

/* GET /api/gallery?limit=24&offset=0
 * → 200 { books: [{ id, story, publishedAt }], hasMore }
 * The feed returns full stories — thumbnails are live mini-renders of the
 * cover card, compiled client-side, so no screenshot service exists. */
app.http('gallery', {
  route: 'gallery',
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: async (request) => {
    const limit = Math.min(48, Math.max(1, Number(request.query.get('limit')) || 24));
    const offset = Math.min(2000, Math.max(0, Number(request.query.get('offset')) || 0));

    const query = {
      // limit + 1 so hasMore needs no second query
      query:
        'SELECT c.id, c.story, c.publishedAt FROM c WHERE c.visibility = @vis ' +
        'ORDER BY c.publishedAt DESC OFFSET @offset LIMIT @limit',
      parameters: [
        { name: '@vis', value: 'published' },
        { name: '@offset', value: offset },
        { name: '@limit', value: limit + 1 },
      ],
    };

    const { resources } = await getContainer().items.query(query).fetchAll();
    const hasMore = resources.length > limit;
    return json(200, { books: resources.slice(0, limit), hasMore });
  },
});
