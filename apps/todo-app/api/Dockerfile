FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY apps/todo-app/UCDavis.CaesAi.Todo.slnx apps/todo-app/UCDavis.CaesAi.Todo.slnx
COPY packages/UCDavis.CaesAi.AppSdk packages/UCDavis.CaesAi.AppSdk
COPY contracts contracts
COPY apps/todo-app/api apps/todo-app/api
RUN dotnet restore apps/todo-app/api/UCDavis.CaesAi.Todo.Api/UCDavis.CaesAi.Todo.Api.csproj
RUN dotnet publish apps/todo-app/api/UCDavis.CaesAi.Todo.Api/UCDavis.CaesAi.Todo.Api.csproj --configuration Release --no-restore --output /app/publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
RUN apt-get update \
    && apt-get install --yes --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD curl --fail --silent http://127.0.0.1:8080/health >/dev/null || exit 1
ENTRYPOINT ["dotnet", "UCDavis.CaesAi.Todo.Api.dll"]
