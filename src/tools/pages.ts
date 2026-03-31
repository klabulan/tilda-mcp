import { z } from "zod";
import { tildaGet } from "../client.js";

export const getProjectsSchema = z.object({});

export async function handleGetProjects(_params: z.infer<typeof getProjectsSchema>): Promise<string> {
  const result = await tildaGet("getprojectslist");
  return JSON.stringify(result, null, 2);
}

export const getPagesSchema = z.object({
  projectid: z.string().describe("ID проекта Tilda"),
});

export async function handleGetPages(params: z.infer<typeof getPagesSchema>): Promise<string> {
  const result = await tildaGet("getpageslist", {
    projectid: params.projectid,
  });
  return JSON.stringify(result, null, 2);
}

export const getPageSchema = z.object({
  pageid: z.string().describe("ID страницы Tilda"),
});

export async function handleGetPage(params: z.infer<typeof getPageSchema>): Promise<string> {
  const result = await tildaGet("getpagefull", {
    pageid: params.pageid,
  });
  return JSON.stringify(result, null, 2);
}
