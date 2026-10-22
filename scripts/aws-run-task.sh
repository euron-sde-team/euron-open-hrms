#!/usr/bin/env bash
# Run a one-off command on the API image as an ECS task, wait for it, print its logs.
#   scripts/aws-run-task.sh <aws-dev|aws-prod> node dist/migrate.js
#   scripts/aws-run-task.sh aws-dev node dist/cli.js operator:create --email you@example.com
set -euo pipefail
ENV="${1:?usage: aws-run-task.sh <env> <command...>}"; shift
DIR="$(cd "$(dirname "$0")/.." && pwd)/infra/terraform/envs/$ENV"
spec=$(terraform -chdir="$DIR" output -json run_task)
field() { echo "$spec" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['$1']))"; }
cluster=$(echo "$spec" | python3 -c "import json,sys; print(json.load(sys.stdin)['cluster'])")
taskdef=$(echo "$spec" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_definition'])")
container=$(echo "$spec" | python3 -c "import json,sys; print(json.load(sys.stdin)['container'])")
cmd=$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@")

network="awsvpcConfiguration={subnets=$(field subnets | tr -d ' "' ),securityGroups=$(field security_groups | tr -d ' "'),assignPublicIp=DISABLED}"
arn=$(aws ecs run-task --cluster "$cluster" --task-definition "$taskdef" --launch-type FARGATE \
  --network-configuration "$network" \
  --overrides "{\"containerOverrides\":[{\"name\":\"$container\",\"command\":$cmd}]}" \
  --query 'tasks[0].taskArn' --output text)
echo "started $arn"
aws ecs wait tasks-stopped --cluster "$cluster" --tasks "$arn"
code=$(aws ecs describe-tasks --cluster "$cluster" --tasks "$arn" --query 'tasks[0].containers[0].exitCode' --output text)
group=$(aws ecs describe-task-definition --task-definition "$taskdef" --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
aws logs tail "$group" --since 15m --format short | tail -40
echo "exit code: $code"
[[ "$code" == "0" ]]
