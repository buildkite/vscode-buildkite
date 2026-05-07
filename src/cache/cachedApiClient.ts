import { BuildkiteClient, Organization } from "../api/client";
import { CacheProvider } from "./cacheProvider";
import { JsonValue, Pipeline, Build, Job, Agent, Artifact, Annotation, PipelineWithBuilds, CreatePipelineInput, UpdatePipelineInput } from "../api/types";

/**
 * Cached API client wrapper that adds caching layer to BuildkiteClient
 * All API calls go through this cache to reduce redundant requests
 */
export class CachedApiClient {
  private client: BuildkiteClient;
  private cache: CacheProvider;
  private readonly CACHE_TTL = 60000; // 60 seconds

  private static instance: CachedApiClient | undefined;

  /**
   * Initialise with the shared BuildkiteClient (constructed in extension.ts
   * with the active AuthManager). Must be called once during activation
   * before any command tries to read the cached client
   */
  static init(client: BuildkiteClient): CachedApiClient {
    if (!CachedApiClient.instance) {
      CachedApiClient.instance = new CachedApiClient(client);
    }
    return CachedApiClient.instance;
  }

  static getInstance(): CachedApiClient {
    if (!CachedApiClient.instance) {
      throw new Error("CachedApiClient not initialised, call CachedApiClient.init first");
    }
    return CachedApiClient.instance;
  }

  private constructor(client: BuildkiteClient) {
    this.client = client;
    this.cache = CacheProvider.getInstance();
  }

  /**
   * Generate cache key for API requests
   */
  private generateCacheKey(method: string, endpoint: string, body?: JsonValue): string {
    const bodyHash = body ? JSON.stringify(body) : "";
    return `${method}:${endpoint}:${bodyHash}`;
  }

  /**
   * Clear cache for manual refresh
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clear cache for specific pipeline (used after mutating actions)
   */
  clearPipelineCache(orgSlug: string, pipelineSlug: string): void {
    const pattern = new RegExp(`organizations/${orgSlug}/pipelines/${pipelineSlug}`);
    this.cache.clearPattern(pattern);
  }

  /**
   * Clear cache for organization (used after token changes)
   */
  clearOrganizationCache(orgSlug: string): void {
    const pattern = `organizations/${orgSlug}`;
    this.cache.clearPattern(pattern);
  }

  /**
   * Drop the underlying client's org cache and every cached response
   */
  clearAll(): void {
    this.client.invalidateOrgCache();
    this.cache.clear();
  }

  /**
   * Get organization with caching
   */
  async getOrganization(): Promise<Organization> {
    const cacheKey = this.generateCacheKey("GET", "/organizations");

    let result = this.cache.get<Organization>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getOrganization();
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get pipelines with caching
   */
  async getPipelines(orgSlug: string): Promise<Pipeline[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines`);

    let result = this.cache.get<Pipeline[]>(cacheKey);
    if (result !== null) {
      console.log(`[Cache HIT] ${cacheKey}`);
      return result;
    }
    console.log(`[Cache MISS] ${cacheKey}`);
    result = await this.client.getPipelines(orgSlug);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get builds with caching
   */
  async getBuilds(orgSlug: string, pipelineSlug: string, perPage = 10): Promise<Build[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds?per_page=${perPage}`);

    let result = this.cache.get<Build[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getBuilds(orgSlug, pipelineSlug, perPage);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get single build with caching
   */
  async getBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Build> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}`);

    let result = this.cache.get<Build>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getBuild(orgSlug, pipelineSlug, buildNumber);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get jobs with caching
   */
  async getJobs(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Job[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs`);

    let result = this.cache.get<Job[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getJobs(orgSlug, pipelineSlug, buildNumber);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get artifacts with caching
   */
  async getArtifacts(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Artifact[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/artifacts`);

    let result = this.cache.get<Artifact[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getArtifacts(orgSlug, pipelineSlug, buildNumber);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get annotations with caching
   */
  async getAnnotations(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Annotation[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/annotations`);

    let result = this.cache.get<Annotation[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getAnnotations(orgSlug, pipelineSlug, buildNumber);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get job artifacts with caching
   */
  async getJobArtifacts(orgSlug: string, pipelineSlug: string, buildNumber: number, jobId: string): Promise<Artifact[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/pipelines/${pipelineSlug}/builds/${buildNumber}/jobs/${jobId}/artifacts`);

    let result = this.cache.get<Artifact[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getJobArtifacts(orgSlug, pipelineSlug, buildNumber, jobId);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get agents with caching
   */
  async getAgents(orgSlug: string): Promise<Agent[]> {
    const cacheKey = this.generateCacheKey("GET", `/organizations/${orgSlug}/agents`);

    let result = this.cache.get<Agent[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getAgents(orgSlug);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get pipelines by repository with caching
   */
  async getPipelinesByRepository(orgSlug: string, repositoryUrl: string): Promise<PipelineWithBuilds[]> {
    const cacheKey = this.generateCacheKey("GRAPHQL", `pipelines:${orgSlug}:${repositoryUrl}`);

    let result = this.cache.get<PipelineWithBuilds[]>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getPipelinesByRepository(orgSlug, repositoryUrl);
    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Get job log with caching (shorter TTL for logs since they change frequently)
   */
  async getJobLog(job: Job): Promise<string> {
    const cacheKey = this.generateCacheKey("GET", job.raw_log_url || "");

    let result = this.cache.get<string>(cacheKey);
    if (result !== null) {
      return result;
    }

    result = await this.client.getJobLog(job);
    // Cache logs for shorter time (30 seconds)
    this.cache.set(cacheKey, result, 30000);
    return result;
  }

  /**
   * Download artifact (no caching for binary content)
   */
  async downloadArtifact(downloadUrl: string): Promise<Response> {
    return this.client.downloadArtifact(downloadUrl);
  }

  // Mutating operations - these clear relevant cache entries

  async rebuildBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Build> {
    const result = await this.client.rebuildBuild(orgSlug, pipelineSlug, buildNumber);
    this.clearPipelineCache(orgSlug, pipelineSlug);
    return result;
  }

  async cancelBuild(orgSlug: string, pipelineSlug: string, buildNumber: number): Promise<Build> {
    const result = await this.client.cancelBuild(orgSlug, pipelineSlug, buildNumber);
    this.clearPipelineCache(orgSlug, pipelineSlug);
    return result;
  }

  async createBuild(orgSlug: string, pipelineSlug: string, body: { commit: string; branch: string }): Promise<Build> {
    const result = await this.client.createBuild(orgSlug, pipelineSlug, body);
    this.clearPipelineCache(orgSlug, pipelineSlug);
    return result;
  }

  async retryJob(orgSlug: string, pipelineSlug: string, buildNumber: number, jobId: string): Promise<Job> {
    const result = await this.client.retryJob(orgSlug, pipelineSlug, buildNumber, jobId);
    this.clearPipelineCache(orgSlug, pipelineSlug);
    return result;
  }

  async unblockJob(orgSlug: string, pipelineSlug: string, buildNumber: number, jobId: string, fields?: Record<string, string>): Promise<Job> {
    const result = await this.client.unblockJob(orgSlug, pipelineSlug, buildNumber, jobId, fields);
    this.clearPipelineCache(orgSlug, pipelineSlug);
    return result;
  }

  // Agent operations
  async stopAgent(orgSlug: string, agentId: string): Promise<void> {
    const result = await this.client.stopAgent(orgSlug, agentId);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async forceStopAgent(orgSlug: string, agentId: string): Promise<void> {
    const result = await this.client.forceStopAgent(orgSlug, agentId);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async pauseAgent(orgSlug: string, agentId: string): Promise<void> {
    const result = await this.client.pauseAgent(orgSlug, agentId);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async resumeAgent(orgSlug: string, agentId: string): Promise<void> {
    const result = await this.client.resumeAgent(orgSlug, agentId);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  // Pipeline management operations
  async createPipeline(orgSlug: string, input: CreatePipelineInput): Promise<Pipeline> {
    const result = await this.client.createPipeline(orgSlug, input);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async updatePipeline(orgSlug: string, pipelineSlug: string, input: UpdatePipelineInput): Promise<Pipeline> {
    const result = await this.client.updatePipeline(orgSlug, pipelineSlug, input);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async archivePipeline(orgSlug: string, pipelineSlug: string): Promise<void> {
    const result = await this.client.archivePipeline(orgSlug, pipelineSlug);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async unarchivePipeline(orgSlug: string, pipelineSlug: string): Promise<void> {
    const result = await this.client.unarchivePipeline(orgSlug, pipelineSlug);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  async deletePipeline(orgSlug: string, pipelineSlug: string): Promise<void> {
    const result = await this.client.deletePipeline(orgSlug, pipelineSlug);
    this.clearOrganizationCache(orgSlug);
    return result;
  }

  /**
   * Get cache statistics for debugging
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Dispose the cached API client
   */
  dispose(): void {
    CacheProvider.disposeInstance();
    CachedApiClient.instance = undefined;
  }
}
