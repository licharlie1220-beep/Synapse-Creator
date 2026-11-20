import { relations } from 'drizzle-orm';
import { integer, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sqlProjects = pgTable('projects', {
  id: serial('id').primaryKey(),
  externalId: text('external_id').notNull().unique(),
  userUid: text('user_uid').notNull(),
  name: text('name').notNull(),
  platform: text('platform').notNull(),
  topic: text('topic').notNull(),
  currentStage: integer('current_stage').notNull().default(1),
  payloadJson: text('payload_json').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sqlChatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  projectExternalId: text('project_external_id').notNull(),
  role: text('role').notNull(),
  personaId: text('persona_id').notNull(),
  modelName: text('model_name').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(sqlProjects),
  chatMessages: many(sqlChatMessages),
}));

export const sqlProjectsRelations = relations(sqlProjects, ({ one }) => ({
  owner: one(users, {
    fields: [sqlProjects.userUid],
    references: [users.uid],
  }),
}));

export const sqlChatMessagesRelations = relations(sqlChatMessages, ({ one }) => ({
  author: one(users, {
    fields: [sqlChatMessages.userUid],
    references: [users.uid],
  }),
}));
