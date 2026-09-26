import { type Db, MongoClient } from 'mongodb';

export async function connectMongo(uri: string, dbName: string): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  return { client, db: client.db(dbName) };
}
