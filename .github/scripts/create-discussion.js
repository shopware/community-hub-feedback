const { graphql } = require("@octokit/graphql");
const fetch = require("node-fetch");

const [owner, repo] = process.env.REPO.split("/");
const issue_number = process.env.ISSUE_NUMBER;
const token = process.env.GITHUB_TOKEN;

// Helper function to get the repo ID
async function getRepoId(owner, repo, token) {
  const res = await graphql(
    `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
        }
      }
    `,
    {
      owner,
      repo,
      headers: { authorization: `token ${token}` },
    }
  );
  return res.repository.id;
}

async function run() {
  // 1. Get the issue data including author
  const { repository } = await graphql(
    `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          issue(number: $number) {
            title
            body
            author {
              login
              url
            }
          }
        }
      }
    `,
    {
      owner,
      repo,
      number: parseInt(issue_number, 10),
      headers: { authorization: `token ${token}` },
    }
  );

  const issue = repository.issue;
  if (!issue) {
    console.error(`Issue #${issue_number} not found! (repo: ${owner}/${repo})`);
    process.exit(1);
  }

  const { title, body, author } = issue;
  const mention = `_**This feature request/idea was raised by [@${author.login}](${author.url})**_`;
  const discussionBody = `${mention}\n\n${body}`;

  // 2. Create the discussion
  const DISCUSSION_CATEGORY_ID = "DIC_kwDOPAbdAc4Cr9dS";

  const createRes = await graphql(
    `
      mutation($repoId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: {
          repositoryId: $repoId,
          categoryId: $categoryId,
          title: $title,
          body: $body
        }) {
          discussion {
            url
          }
        }
      }
    `,
    {
      repoId: await getRepoId(owner, repo, token),
      categoryId: DISCUSSION_CATEGORY_ID,
      title,
      body: discussionBody,
      headers: { authorization: `token ${token}` },
    }
  );

  const discussionUrl = createRes.createDiscussion.discussion.url;
  console.log("Discussion created:", discussionUrl);

  // 3. Post a comment to the original issue
  const issueComment = `This issue was migrated to a [Discussion](${discussionUrl}).`;

  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
    method: "POST",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ body: issueComment }),
  });
  console.log("Created a comment on the original issue.");

  // 4. Close the issue
  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}`, {
    method: "PATCH",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ state: "closed" }),
  });
  console.log("Closed the original issue.");

  // 5. Remove 'issue-to-discussion' label and add 'migrated-to-discussion' while preserving other labels
  const labelsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/labels`, {
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
    },
  });
  const existingLabels = (await labelsRes.json()).map(l => l.name);

  const filteredLabels = existingLabels.filter(l => l !== "issue-to-discussion");
  if (!filteredLabels.includes("💡 Feature Request")) {
    filteredLabels.push("💡 Feature Request");
  }

  await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/labels`, {
    method: "PUT",
    headers: {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github+json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ labels: filteredLabels }),
  });
  console.log("Label '💡 Feature Request' set and 'issue-to-discussion' removed!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
