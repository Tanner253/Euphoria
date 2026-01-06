/**
 * MongoDB Connection for Game Server
 * 
 * Connects to the same MongoDB as the Next.js app.
 * All data flows through the server - clients just render.
 */

import { MongoClient, Db, Collection } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
  if (client && db) {
    return { client, db };
  }

  const MONGODB_URI = process.env.MONGODB_URI || '';
  
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    console.log('[Database] Connected to MongoDB');
    return { client, db };
  } catch (error) {
    console.error('[Database] Connection failed');
    throw error;
  }
}

export async function getCollection<T extends Document>(name: string): Promise<Collection<T>> {
  const { db } = await connectToDatabase();
  return db.collection<T>(name);
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[Database] Connection closed');
  }
}

