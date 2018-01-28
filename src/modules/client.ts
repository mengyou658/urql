import uuid from 'uuid';

import { IClientOptions, IMutation, IQuery } from '../interfaces/index';
import { gankTypeNamesFromResponse } from '../modules/typenames';
import { hashString } from './hash';

// Response from executeQuery call
export interface IQueryResponse {
  data: object[];
  typeNames?: string[];
}

export default class Client {
  url?: string; // Graphql API URL
  store: object; // Internal store
  fetchOptions: object | (() => object); // Options for fetch call
  subscriptions: object; // Map of subscribed Connect components

  constructor(opts?: IClientOptions) {
    if (!opts) {
      throw new Error('Please provide configuration object');
    }
    // Set option/internal defaults
    if (!opts.url) {
      throw new Error('Please provide a URL for your GraphQL API');
    }
    this.url = opts.url;
    this.fetchOptions = opts.fetchOptions || {};
    this.store = {};
    this.subscriptions = {};
    // Bind methods
    this.executeQuery = this.executeQuery.bind(this);
    this.executeMutation = this.executeMutation.bind(this);
    this.updateSubscribers = this.updateSubscribers.bind(this);
  }

  updateSubscribers(typenames, changes) {
    // On mutation, call subscribed callbacks with eligible typenames
    for (const sub in this.subscriptions) {
      if (this.subscriptions.hasOwnProperty(sub)) {
        this.subscriptions[sub](typenames, changes);
      }
    }
  }

  subscribe(
    callback: (changedTypes: string[], response: object) => void
  ): string {
    // Create an identifier, add callback to subscriptions, return identifier
    const id = uuid.v4();
    this.subscriptions[id] = callback;
    return id;
  }

  unsubscribe(id: string) {
    // Delete from subscriptions by identifier
    delete this.subscriptions[id];
  }

  executeQuery(
    queryObject: IQuery,
    skipCache: boolean
  ): Promise<IQueryResponse> {
    return new Promise<IQueryResponse>((resolve, reject) => {
      const { query, variables } = queryObject;
      // Create query POST body
      const body = JSON.stringify({
        query,
        variables,
      });

      // Create hash from serialized body
      const hash = hashString(body);

      // Check cache for hash
      if (this.store[hash] && !skipCache) {
        const typeNames = gankTypeNamesFromResponse(this.store[hash]);
        resolve({ data: this.store[hash], typeNames });
      } else {
        const fetchOptions =
          typeof this.fetchOptions === 'function'
            ? this.fetchOptions()
            : this.fetchOptions;
        // Fetch data
        fetch(this.url, {
          body,
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          ...fetchOptions,
        })
          .then(res => res.json())
          .then(response => {
            if (response.data) {
              // Grab typenames from response data
              const typeNames = gankTypeNamesFromResponse(response.data);
              // Store data in cache, using serialized query as key
              this.store[hash] = response.data;
              resolve({
                data: response.data,
                typeNames,
              });
            } else {
              reject({
                message: 'No data',
              });
            }
          })
          .catch(e => {
            reject(e);
          });
      }
    });
  }

  executeMutation(mutationObject: IMutation): Promise<object[]> {
    return new Promise<object[]>((resolve, reject) => {
      const { query, variables } = mutationObject;
      // Convert POST body to string
      const body = JSON.stringify({
        query,
        variables,
      });

      const fetchOptions =
        typeof this.fetchOptions === 'function'
          ? this.fetchOptions()
          : this.fetchOptions;
      // Call mutation
      fetch(this.url, {
        body,
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        ...fetchOptions,
      })
        .then(res => res.json())
        .then(response => {
          if (response.data) {
            // Retrieve typenames from response data
            const typeNames = gankTypeNamesFromResponse(response.data);
            // Notify subscribed Connect wrappers
            this.updateSubscribers(typeNames, response);

            resolve(response.data);
          } else {
            reject({
              message: 'No data',
            });
          }
        })
        .catch(e => {
          reject(e);
        });
    });
  }
}
