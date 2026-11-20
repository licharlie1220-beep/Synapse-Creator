import { and, desc, eq } from 'drizzle-orm';
import { db } from './index.ts';
import { sqlChatMessages, sqlProjects } from './schema.ts';

export async function listUserSqlProjects(userUid: string) {
  try {
    return await db
      .select()
      .from(sqlProjects)
      .where(eq(sqlProjects.userUid, userUid))
      .orderBy(desc(sqlProjects.updatedAt));
  } catch (error) {
    console.error('Database query failed (listUserSqlProjects):', error);
    throw new Error('Failed to load SQL projects. Please try again later.', { cause: error });
  }
}

export async function upsertUserSqlProject(params: {
  externalId: string;
  userUid: string;
  name: string;
  platform: string;
  topic: string;
  currentStage: number;
  payloadJson: string;
}) {
  try {
    const result = await db
      .insert(sqlProjects)
      .values({
        externalId: params.externalId,
        userUid: params.userUid,
        name: params.name,
        platform: params.platform,
        topic: params.topic,
        currentStage: params.currentStage,
        payloadJson: params.payloadJson,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sqlProjects.externalId,
        set: {
          name: params.name,
          platform: params.platform,
          topic: params.topic,
          currentStage: params.currentStage,
          payloadJson: params.payloadJson,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database mutation failed (upsertUserSqlProject):', error);
    throw new Error('Failed to save project to SQL database.', { cause: error });
  }
}

export async function deleteUserSqlProject(userUid: string, externalId: string) {
  try {
    await db
      .delete(sqlProjects)
      .where(and(eq(sqlProjects.externalId, externalId), eq(sqlProjects.userUid, userUid)));
  } catch (error) {
    console.error('Database deletion failed (deleteUserSqlProject):', error);
    throw new Error('Failed to delete project from SQL database.', { cause: error });
  }
}

export async function listSqlChatMessages(userUid: string, projectExternalId: string) {
  try {
    return await db
      .select()
      .from(sqlChatMessages)
      .where(
        and(
          eq(sqlChatMessages.userUid, userUid),
          eq(sqlChatMessages.projectExternalId, projectExternalId)
        )
      )
      .orderBy(sqlChatMessages.id);
  } catch (error) {
    console.error('Database query failed (listSqlChatMessages):', error);
    throw new Error('Failed to load chat history from SQL database.', { cause: error });
  }
}

export async function appendSqlChatMessage(params: {
  userUid: string;
  projectExternalId: string;
  role: string;
  personaId: string;
  modelName: string;
  content: string;
}) {
  try {
    const result = await db
      .insert(sqlChatMessages)
      .values({
        userUid: params.userUid,
        projectExternalId: params.projectExternalId,
        role: params.role,
        personaId: params.personaId,
        modelName: params.modelName,
        content: params.content,
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database insert failed (appendSqlChatMessage):', error);
    throw new Error('Failed to persist chat message to SQL database.', { cause: error });
  }
}
