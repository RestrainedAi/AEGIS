# Makefile for the sunopipeline service

# Default values for variables.
# To override, use: make target VAR=value
# Example: make deploy PROJECT_ID=my-gcp-project

PROJECT_ID   ?= $(shell gcloud config get-value project 2> /dev/null)
SERVICE_NAME ?= sunopipeline-api
REGION       ?= us-central1
BUCKET       ?= sunopipeline-artifacts-prod

.PHONY: all install build run dev deploy help

all: help

## --------------------------------------
## Development
## --------------------------------------

install: ## Install root and workspace node dependencies
	@echo "--> Installing dependencies..."
	npm install

build: install ## Build all workspaces
	@echo "--> Building packages/core..."
	npm run -w packages/core build
	@echo "--> Building apps/api..."
	npm run -w apps/api build

dev: install ## Run the service locally in development mode (with tsx watch)
	@echo "--> Running service locally on port 8080..."
	@echo "Note: YT_API_KEY environment variable must be set."
	npm run -w apps/api dev

run: build ## Run the built service locally
	@echo "--> Starting the built service locally on port 8080..."
	npm run -w apps/api start

## --------------------------------------
## Deployment
## --------------------------------------

deploy: build ## Deploy the service to Google Cloud Run
	@if [ -z "$(PROJECT_ID)" ]; then \
		echo "Error: PROJECT_ID is not set. Please run 'gcloud config set project YOUR_PROJECT_ID' or pass it as an argument: 'make deploy PROJECT_ID=YOUR_PROJECT_ID'"; \
		exit 1; \
	fi
	@if [ -z "$$YT_API_KEY" ]; then \
		echo "Error: YT_API_KEY environment variable is not set. Please export it before running deploy."; \
		exit 1; \
	fi
	@echo "--> Deploying service $(SERVICE_NAME) to region $(REGION) in project $(PROJECT_ID)..."
	gcloud run deploy $(SERVICE_NAME) \
		--source . \
		--region $(REGION) \
		--project $(PROJECT_ID) \
		--set-env-vars=BUCKET=$(BUCKET) \
		--set-secrets=YT_API_KEY=YT_API_KEY:latest \
		--allow-unauthenticated

## --------------------------------------
## Help
## --------------------------------------

help: ## Show this help message
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'