import mongoose from 'mongoose';
import { config } from './config.js';

mongoose.set('strictQuery', true);

/** Connects to MongoDB and builds the indexes declared on the schemas. */
export async function connectDb(uri = config.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await mongoose.connection.syncIndexes();
  return mongoose.connection;
}

export const disconnectDb = () => mongoose.disconnect();

/** Hides credentials when the connection string is printed. */
export const safeUri = (uri) => uri.replace(/\/\/([^@/]+)@/, '//***@');
