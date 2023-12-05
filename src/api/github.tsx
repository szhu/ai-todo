import { Octokit } from "octokit";

const headers = {
  "X-GitHub-Api-Version": "2022-11-28",
};

const request = {
  cache: "reload",
};

export async function getGistFile(
  auth: string,
  gistId: string,
  filename: string,
) {
  const octokit = new Octokit({ auth });
  const response = await octokit.request("GET /gists/{gist_id}", {
    headers,
    v: Math.floor(Date.now() / 1000),
    gist_id: gistId,
  });

  return response.data.files?.[filename]?.content;
}

export async function updateGistFile(
  auth: string,
  gistId: string,
  filename: string,
  content: string,
) {
  const octokit = new Octokit({ auth });
  await octokit.request("PATCH /gists/{gist_id}", {
    headers,
    gist_id: gistId,
    files: {
      [filename]: { content },
    },
  });
}
