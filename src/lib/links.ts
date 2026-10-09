// Where the code lives, and where requests for new indications go (a GitHub issue form,
// .github/ISSUE_TEMPLATE/request-indication.yml). Override with NEXT_PUBLIC_REPO_URL.
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || 'https://github.com/khushishelat/clinical-research-demo';
export const REQUEST_URL = `${REPO_URL}/issues/new?template=request-indication.yml`;
