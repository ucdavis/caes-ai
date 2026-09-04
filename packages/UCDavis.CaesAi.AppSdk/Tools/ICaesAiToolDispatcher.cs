namespace UCDavis.CaesAi.AppSdk;

/// <summary>
/// Dispatches only the application-owned tools declared in its session manifest.
/// </summary>
public interface ICaesAiToolDispatcher
{
    Task<ToolExecutionResponse> ExecuteAsync(
        ToolExecutionRequest request,
        string userReference,
        CancellationToken cancellationToken);
}
