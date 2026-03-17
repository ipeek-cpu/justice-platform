ALTER TABLE "oauth_tokens" DROP CONSTRAINT "oauth_tokens_user_identity_unique";--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "account_email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_account_uniq" UNIQUE("user_identity","account_email");