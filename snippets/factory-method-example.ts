// ============================================================================
// 1. CONTRACTS AND LIBRARY (Infrastructure)
// ============================================================================

interface DurableExecutionLogger {
    logExecutionStart(id: string, name: string, input?: any): void;
    logExecutionEnd(id: string, name: string, output?: any): void;
}

class DurableExecutionLoggerImpl implements DurableExecutionLogger {
    logExecutionStart(id: string, name: string, input?: any): void {
        console.log(`[LOG] Execution started: ${id}, Function: ${name}`, input || '');
    }

    logExecutionEnd(id: string, name: string, output?: any): void {
        console.log(`[LOG] Execution ended: ${id}, Function: ${name}`, output || '');
    }
}

class DurableExecutionFactory {
    private static workflowClientInstance: WorkflowClient;
    private static stepClientInstance: WorkflowStepClient;
    
    // Configuração do Workflow Client
    static setWorkflowClient(client: WorkflowClient) { 
        this.workflowClientInstance = client; 
    }
    static getWorkflowClient(): WorkflowClient { 
        return this.workflowClientInstance; 
    }

    // Configuração do Step Client
    static setWorkflowStepClient(client: WorkflowStepClient) { 
        this.stepClientInstance = client; 
    }
    static getWorkflowStepClient(): WorkflowStepClient { 
        return this.stepClientInstance; 
    }
}

// --- CLIENT CONTRACTS ---
interface WorkflowStepClient {
    dispatchStep<T>(step: WorkflowStep<T>): Promise<T>;
}

interface WorkflowClient {
    dispatchWorkflow<T>(workflow: Workflow<T>): Promise<T>;
}

// --- BASE ABSTRACTIONS (Where the encapsulation magic happens) ---
abstract class WorkflowStep<T> {
    abstract executeStep(): Promise<T>;

    // The Template Method remains here, guaranteeing the logs
    async dispatch(logger: DurableExecutionLogger): Promise<T> {
        logger.logExecutionStart('step-id', this.constructor.name);
        const result = await this.executeStep();
        logger.logExecutionEnd('step-id', this.constructor.name, result);
        return result;
    }
}

abstract class Workflow<T> {
    protected workflowStepClient: WorkflowStepClient;

    constructor() {
        this.workflowStepClient = DurableExecutionFactory.getWorkflowStepClient();
    }

    abstract execute(): Promise<T>;
}

// --- CLIENT IMPLEMENTATIONS (Examples only) ---
class DefaultWorkflowStepClient implements WorkflowStepClient {
    constructor(private logger: DurableExecutionLogger) {}

    async dispatchStep<T>(step: WorkflowStep<T>): Promise<T> {
        return await step.dispatch(this.logger); 
    }
}

class WorkflowClientTemporal implements WorkflowClient {
    async dispatchWorkflow<T>(workflow: Workflow<T>): Promise<T> {
        console.log("-> [Temporal Engine] Starting Workflow...");
        return await workflow.execute(); 
    }
}


// ============================================================================
// 2. APPLICATION BUSINESS LOGIC (Daily use)
// ============================================================================

class CreateUserStep extends WorkflowStep<string> {
    async executeStep(): Promise<string> {
        console.log("   Processing user creation...");
        return "USER_ID_123";
    }
}

class SendEmailStep extends WorkflowStep<void> {
    constructor(private userId: string) { super(); }
    
    async executeStep(): Promise<void> {
        console.log(`   Sending welcome email to user: ${this.userId}`);
    }
}

// Look how the Workflow is now "As Code"!
class CreateTeamWorkflow extends Workflow<void> {
    async execute(): Promise<void> {
        // Step 1: Create the user and get the return value
        const userId = await this.workflowStepClient.dispatchStep(new CreateUserStep());
        
        // Free business logic happening in the middle! (Your Lead's golden point)
        if (userId !== null) {
            // Step 2: Use data from step 1 to execute step 2
            await this.workflowStepClient.dispatchStep(new SendEmailStep(userId));
        }
    }
}


// ============================================================================
// 3. INITIALIZATION AND EXECUTION (Composition Root in practice)
// ============================================================================

async function main() {
    // A. BOOTSTRAP (Centralizado em uma única Factory)
    const logger = new DurableExecutionLoggerImpl();
    
    DurableExecutionFactory.setWorkflowStepClient(new DefaultWorkflowStepClient(logger));
    DurableExecutionFactory.setWorkflowClient(new WorkflowClientTemporal());

    // B. EXECUÇÃO DIÁRIA
    const client = DurableExecutionFactory.getWorkflowClient();
    await client.dispatchWorkflow(new CreateTeamWorkflow());
}
// Running the script
main().catch(console.error);


