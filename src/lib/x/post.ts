import { TwitterApi, ApiResponseError } from "twitter-api-v2";

export class XPostError extends Error {
  status: number;
  /** true => transient; leave the post scheduled for a later run. */
  retryable: boolean;
  /** true => the token is dead; force a refresh and retry once. */
  tokenProblem: boolean;
  /** For 429s: epoch seconds when the limit resets. */
  resetAt?: number;

  constructor(
    message: string,
    opts: {
      status: number;
      retryable: boolean;
      tokenProblem?: boolean;
      resetAt?: number;
    }
  ) {
    super(message);
    this.name = "XPostError";
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.tokenProblem = opts.tokenProblem ?? false;
    this.resetAt = opts.resetAt;
  }
}

function detailOf(err: ApiResponseError): string {
  const data = err.data as unknown as
    | { detail?: string; title?: string }
    | undefined;
  return data?.detail || data?.title || JSON.stringify(err.data ?? {}).slice(0, 200);
}

function classifyXError(err: unknown): XPostError {
  if (err instanceof ApiResponseError) {
    const status = err.code;
    if (status === 401) {
      return new XPostError(`X auth failed (401): ${detailOf(err)}`, {
        status,
        retryable: false,
        tokenProblem: true,
      });
    }
    if (status === 429) {
      return new XPostError(`X rate limited (429): ${detailOf(err)}`, {
        status,
        retryable: true,
        resetAt: err.rateLimit?.reset,
      });
    }
    if (status === 403) {
      // Duplicate content, account/app restriction, policy violation: fatal
      // for this post (retrying the same text won't help).
      return new XPostError(`X rejected the post (403): ${detailOf(err)}`, {
        status,
        retryable: false,
      });
    }
    if (status >= 500) {
      return new XPostError(`X server error (${status}): ${detailOf(err)}`, {
        status,
        retryable: true,
      });
    }
    return new XPostError(`X rejected the post (${status}): ${detailOf(err)}`, {
      status,
      retryable: false,
    });
  }
  // Network / unknown: transient
  return new XPostError(
    `Network error posting to X: ${err instanceof Error ? err.message : String(err)}`,
    { status: 0, retryable: true }
  );
}

export type PostTweetArgs = {
  accessToken: string;
  text: string;
  /** When set, posts as a reply (used to chain a thread). */
  inReplyToTweetId?: string;
};

/**
 * Publishes one tweet. Retries 5xx/network twice in-call (1s/2s); all other
 * failures throw a classified XPostError for the dispatcher to act on.
 */
export async function postTweet(args: PostTweetArgs): Promise<{ tweetId: string }> {
  const client = new TwitterApi(args.accessToken);
  const payload = args.inReplyToTweetId
    ? { reply: { in_reply_to_tweet_id: args.inReplyToTweetId } }
    : undefined;

  let lastError: XPostError | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * 1000));
    }
    try {
      const res = await client.v2.tweet(args.text, payload);
      return { tweetId: res.data.id };
    } catch (err) {
      const classified = classifyXError(err);
      // Rate limits are retryable across runs, not within this loop.
      if (!classified.retryable || classified.status === 429) {
        throw classified;
      }
      lastError = classified;
    }
  }
  throw lastError!;
}
