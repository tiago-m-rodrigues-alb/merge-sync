import * as core from '@actions/core';
import * as github from '@actions/github';
import type { PullRequest } from '@octokit/webhooks-types';
/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const githubToken = core.getInput('GITHUB_TOKEN');
    const octokit = github.getOctokit(githubToken);

    const pullRequest = github.context.payload.pull_request as
      | PullRequest
      | undefined;

    if (pullRequest === null || pullRequest === undefined) {
      core.setFailed('No pull request found.');

      return;
    }
    const isClosedAndMerged =
      pullRequest.state === 'closed' && !!pullRequest.merged;

    if (!isClosedAndMerged) {
      core.info('Pull request is not closed and merged.');
      return;
    }

    const mergeVersions = pullRequest.labels
      .filter((label) => label.name.startsWith('merge:'))
      .map((label) => label.name.replace('merge:', '').trim());

    if (mergeVersions.length === 0) {
      core.info('No labels found on the pull request.');
      return;
    }
    for (const version of mergeVersions) {
      const branch = await getBranch(version, github.context.repo, octokit);
      core.info(`Match found: ${version} is in ${branch}`);
    }
  } catch (error) {
    // Fail the workflow run if an error occurs
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

async function getBranch(
  version: string,
  repo: typeof github.context.repo,
  octokit: ReturnType<typeof github.getOctokit>
) {
  try {
    const branch = octokit.rest.repos.getBranch({ ...repo, branch: version });
    return branch;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    const developVersion = await getDevelopVersion(repo, octokit);

    if (developVersion === version) {
      return 'develop';
    }

    return null;
  }
}
async function getDevelopVersion(
  repo: typeof github.context.repo,
  octokit: ReturnType<typeof github.getOctokit>
) {
  const response = await octokit.rest.repos.getContent({
    ...repo,
    path: 'pom.xml',
    ref: 'develop' // optional, defaults to default branch
  });

  if (
    Array.isArray(response.data) ||
    response.data.type !== 'file' ||
    !response.data.content
  ) {
    return null;
  }

  const content = Buffer.from(response.data.content, 'base64').toString(
    'utf-8'
  );
  const regex = /<version>(.*?)<\/version>/;
  const match = content.match(regex);

  if (!match?.[1]) {
    core.info('Version not found in pom.xml');
    return null;
  }

  const version = match[1];
  core.info(`Version found: ${version}`);

  return `v${version}`;
}

function createPullRequest(
  branch: string,
  pullRequest: PullRequest,
  repo: typeof github.context.repo,
  octokit: ReturnType<typeof github.getOctokit>
) {
  const title = `Merge ${branch} into ${pullRequest.base.ref}`;
  const body = `This pull request merges ${branch} into ${pullRequest.base.ref}.`;

  octokit.rest.pulls.create({
    ...repo,
    title,
    body,
    head: branch,
    base: pullRequest.base.ref
  });
  core.info(`Pull request created: ${title}`);
}
