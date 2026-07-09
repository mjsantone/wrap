'use strict';

/* Cosmos DB access. Configuration via app settings:
 *   COSMOS_CONNECTION_STRING            (or COSMOS_ENDPOINT + COSMOS_KEY)
 *   COSMOS_DATABASE   default "book"
 *   COSMOS_CONTAINER  default "books"   (partition key /id)
 * The client is cached across invocations of a warm Function instance. */

const { CosmosClient } = require('@azure/cosmos');

let cachedContainer = null;

function getContainer() {
  if (cachedContainer) return cachedContainer;

  const conn = process.env.COSMOS_CONNECTION_STRING;
  const endpoint = process.env.COSMOS_ENDPOINT;
  const key = process.env.COSMOS_KEY;

  let client;
  if (conn) client = new CosmosClient(conn);
  else if (endpoint && key) client = new CosmosClient({ endpoint, key });
  else throw new Error('Cosmos is not configured: set COSMOS_CONNECTION_STRING or COSMOS_ENDPOINT + COSMOS_KEY');

  cachedContainer = client
    .database(process.env.COSMOS_DATABASE || 'book')
    .container(process.env.COSMOS_CONTAINER || 'books');
  return cachedContainer;
}

module.exports = { getContainer };
