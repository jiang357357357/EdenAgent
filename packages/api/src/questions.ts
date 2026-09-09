import { z } from 'zod'

export const questionItemSchema = z.object({
  header: z.string().trim().min(1).max(80), question: z.string().trim().min(1).max(4000),
  options: z.array(z.object({ label: z.string().trim().min(1).max(200), description: z.string().max(1000).default('') }).strict()).max(12).default([]),
  multiple: z.boolean().default(false), custom: z.boolean().default(true),
}).strict()
export const questionAskSchema = z.object({ questions: z.array(questionItemSchema).min(1).max(3) }).strict()
export const questionListSchema = z.object({ sessionId: z.string().uuid().nullish() }).strict()
export const questionIdSchema = z.object({ requestId: z.string().uuid() }).strict()
export const questionResolveSchema = questionIdSchema.extend({ answers: z.array(z.array(z.string().trim().min(1).max(4000)).min(1).max(12)).min(1).max(3) })
export type QuestionItem = z.infer<typeof questionItemSchema>
export interface QuestionRequest { id: string; sessionId: string; turnId: string; state: string; questions: QuestionItem[]; createdAt: number }
