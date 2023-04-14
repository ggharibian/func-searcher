from os import environ
import openai

openai.api_key = environ["OPENAI_APIKEY"]

def get_response(func: str, module=None):

    # EXTRA STRINGS: "Utilize the following format for response: [next_player, response_string]. The value of 'next_player' is the player that you are talking to, and 'response_string' is your response."
    func_plus_module = f'{func} in the module {module}' if module is not None else func
    
    message_log = [
        {"role": "system", "content": f"You are a responder assistant. Given a question, you will only reply with the answer to the question, and no other information."}
    ]

    message_log.append({"role": "user", "content": f"Describe what the python function '{func_plus_module}' does. Give a description of inputs, outputs, and use cases for the function."})

    # Add a message from the chatbot to the conversation history
    message_log.append(
        {"role": "assistant", "content": "You are a helpful assistant."})

    # Use OpenAI's ChatCompletion API to get the chatbot's response
    response = openai.ChatCompletion.create(
        model="gpt-3.5-turbo",  # The name of the OpenAI chatbot model to use
        # The conversation history up to this point, as a list of dictionaries
        messages=message_log,
        # The maximum number of tokens (words or subwords) in the generated response
        max_tokens=1000,
        # The stopping sequence for the generated response, if any (not used here)
        stop=None,
        # The "creativity" of the generated response (higher temperature = more creative)
        temperature=1,
    )

    # Find the first response from the chatbot that has text in it (some responses may not have text)
    for choice in response.choices:
        if "text" in choice:
            return choice.text

    return response.choices[0].message.content

if __name__ == '__main__':
    print(get_response('read_csv', 'pandas'))