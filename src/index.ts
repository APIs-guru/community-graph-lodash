#!/usr/bin/env node
import 'core-js/shim';

import {
  print,
  DocumentNode,
  buildClientSchema,
  extendSchema,
  introspectionQuery,
} from 'graphql';

type RequestInfo = {
  document: DocumentNode,
  variables?: {[name: string]: any};
  operationName?: string;
  result?: any;
};

import {
  graphqlLodash,
  lodashDirectiveAST,
} from 'graphql-lodash';

import fetch from 'node-fetch';
import {Headers} from 'node-fetch';

import * as express from 'express';
import * as graphqlHTTP from 'express-graphql';
import * as chalk from 'chalk';
import * as cors from 'cors';
import * as set from 'lodash/set.js';

const DEFAULT_PORT = 9002;
const argv = require('yargs')
  .usage('Usage: $0 [URL]')
  .alias('p', 'port')
  .nargs('p', 1)
  .describe('p', 'HTTP Port')
  .default('p', DEFAULT_PORT)
  .alias('H', 'header')
  .describe('H', 'Specify headers to the proxied server in cURL format,' +
     'e.g.: "Authorization: bearer XXXXXXXXX"')
  .nargs('H', 1)
  .alias('co', 'cors-origin')
  .nargs('co', 1)
  .describe('co', 'CORS: Define Access-Control-Allow-Origin header')
  .help('h')
  .alias('h', 'help')
  .argv

const log = console.log;

let headers = {};
if (argv.header) {
  const headerStrings = Array.isArray(argv.header) ? argv.header : [argv.header];
  for (var str of headerStrings) {
    const index = str.indexOf(':');
    const name = str.substr(0, index);
    const value = str.substr(index + 1).trim();
    headers[name] = value;
  }
}

const corsOptions = {}

if (argv.co) {
  corsOptions['origin'] =  argv.co
  corsOptions['credentials'] =  true
}

let urlArg = argv._[0];

getIntrospection().then(introspection => {
  introspection.data.__schema.types.forEach(type => {
    if (type.name !== '_QueryTypeOrdering')
      return;

    type.enumValues = [{
      name: 'dummy',
      description: null,
      isDeprecated: false,
      deprecationReason: null
    }];
  });

  const clientSchema = buildClientSchema(introspection.data);
  let schema = extendSchema(clientSchema, lodashDirectiveAST);

  const app = express();
  app.options('/graphql', cors(corsOptions))
  app.use('/graphql', cors(corsOptions), graphqlHTTP(() => {
    let gqlLodashResult;

    return {
      graphiql: true,
      schema,
      rootValue: (info: RequestInfo) => {
        // TODO copy headers
        const operationName = info.operationName;
        const variables = info.variables;

        gqlLodashResult = graphqlLodash(info.document, operationName);
        const query = print(gqlLodashResult.query);

        return graphqlFetch(query, variables, operationName)
          .then(result => buildRootValue(result));
      },
      extensions: (info) => {
        if (info.result.data)
          info.result.data = gqlLodashResult.transform(info.result.data);
      },
    };
  }));
  app.listen(argv.port);
  log(`\n${chalk.green('✔')} Your GraphQL Fake API is ready to use 🚀
  http://localhost:${argv.port}/graphql
  `);
});

function buildRootValue(response) {
  const rootValue = response.data;
  const globalErrors = [];

  for (const error of (response.errors || [])) {
    if (!error.path)
      globalErrors.push(error);

    // Recreate root value up to a place where original error was thrown
    // and place error as field value.
    set(rootValue, error.path, new Error(error.message))
  }

  // TODO proxy global errors
  if (globalErrors.length !== 0)
    console.error('Global Errors:\n', globalErrors);

  return rootValue;
}

function getIntrospection() {
  return graphqlFetch(introspectionQuery)
    .then(introspection => {
      if (introspection.errors)
        throw Error(JSON.stringify(introspection.errors, null, 2));
      return introspection;
    })
    .catch(error => {
      throw Error(`Can't get introspection from ${urlArg}:\n${error.message}`);
    })
}

function graphqlFetch(query, variables?, operationName?) {
  return fetch(urlArg, {
    method: 'POST',
    headers: new Headers({
      "content-type": 'application/json',
      ...headers,
    }),
    body: JSON.stringify({
      operationName,
      query,
      variables,
    })
  }).then(responce => {
    if (responce.ok)
      return responce.json();
    return responce.text().then(body => {
      throw Error(`${responce.status} ${responce.statusText}\n${body}`);
    });
  });
}
