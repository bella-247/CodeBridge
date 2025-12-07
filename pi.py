from pprint import pprint
import requests

slug = "apply-operations-to-make-all-array-elements-equal-to-zero"
url = "https://leetcode.com/graphql/"

query = {
    "query": """
    query getQuestionDetail($titleSlug: String!) {
      question(titleSlug: $titleSlug) {
        questionId
        title
        difficulty
      }
    }
    """,
    "variables": {"titleSlug": slug},
}

response = requests.post(url, json=query)
data = response.json()

print(data["data"]["question"]["questionId"])  # Problem number
print(data["data"]["question"]["title"])  # Problem name
pprint(data)
