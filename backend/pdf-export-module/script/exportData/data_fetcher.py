import copy
import json
import random
import string
from argparse import Namespace

import firebase_admin
from firebase_admin import credentials, firestore

from exportData.utils import convert_document

# defines order of meal types
meal_types = ['Zmorgen', 'Znüni', 'Zmittag', 'Zvieri', 'Znacht', 'Dessert', 'Leitersnack', 'Vorbereiten']


class DataFetcher(object):

    def __init__(self, args: Namespace):
        self.camp_id = args.camp_id
        self.user_id = args.user_id

        self.args = args

        self._user_data_fetched = False
        self._camp_meta_info_fetched = False
        self._specific_meals_loaded = False
        self._meals_loaded = False
        self._recipes_loaded = False

        self._user_data = None
        self._used_meal_types = None
        self._camp_meta_info = None
        self._specific_meals = None

        with open('../keys/environment/environment.json') as json_file:
            project_and_bucket_name = json.load(json_file)['storage_bucket_name']

        # Use the application default credentials
        cred = credentials.Certificate('../keys/firebase/{}-firebase-adminsdk.json'.format(project_and_bucket_name))
        app = firebase_admin.initialize_app(
            cred,
            name=''.join(random.choice(string.ascii_uppercase + string.digits) for _ in range(8)))
        self.__db = firestore.client(app)

    def setMockData(self, user_data, camp_meta_info, specific_meals):
        self._user_data_fetched = True
        self._camp_meta_info_fetched = True
        self._specific_meals_loaded = True
        self._meals_loaded = True
        self._recipes_loaded = True

        self._user_data = user_data
        self._camp_meta_info = camp_meta_info
        self._specific_meals = specific_meals

    def _fetch_user_data(self):
        if not self._user_data_fetched:
            user_ref = self.__db.document(u'users/' + self.user_id)
            self._user_data = user_ref.get().to_dict()
        self._user_data_fetched = True

    def _fetch_camp_meta_data(self):
        if not self._camp_meta_info_fetched:
            camp_ref = self.__db.document(u'camps/' + self.camp_id)
            self._camp_meta_info = camp_ref.get().to_dict()

        # sort days according to its dates
        self._camp_meta_info.get('days').sort(key=lambda d: d.get('day_date'))

        self._camp_meta_info_fetched = True

    def _fetch_specific_meals(self):
        if not self._specific_meals_loaded:
            meal_refs = self.__db.collection_group(u'specificMeals')
            query_ref = meal_refs.where(u'used_in_camp', u'==', self.camp_id)
            self._specific_meals = list(map(lambda doc: convert_document(doc), query_ref.stream()))

            for meal in self._specific_meals:
                meal['meal_weekview_name'] = meal['meal_weekview_name'].replace('&', '\&')

        self._specific_meals_loaded = True

    def _fetch_meals(self):
        """
          Load the data form the meal object and add it to the specific meal data.
          The following fields gets added: 'meal_name'

        """

        if self._meals_loaded:
            return

        if not self._specific_meals_loaded:
            self._fetch_specific_meals()

        meal_refs = self.__db.collection(u'meals')
        query_ref = meal_refs.where(u'used_in_camps', u'array_contains', self.camp_id)

        meals = list(map(lambda doc: convert_document(doc), query_ref.stream()))

        for meal in meals:

            meal['meal_name'] = meal['meal_name'].replace('&', ' und ')

            for specMeal in self._specific_meals:
                if specMeal['meal_id'] == meal['doc_id']:
                    specMeal['meal_name'] = meal['meal_name']
                    print(specMeal['meal_name'])
                    specMeal['meal_description'] = meal['meal_description']

        self._meals_loaded = True

    def _fetch_recipes(self):
        if self._recipes_loaded:
            return

        if not self._specific_meals_loaded:
            self._fetch_specific_meals()

        if not self._meals_loaded:
            self._fetch_meals()

        meal_ids = list(dict.fromkeys(map(lambda m: m['meal_id'], self._specific_meals)))

        recipes = []

        # Load recipes for DB
        # 'array_contains_any' supports max 10 values
        for meal_ids_max_10 in [meal_ids[x:x + 10] for x in range(0, len(meal_ids), 10)]:
            recipe_refs = self.__db.collection(u'recipes')
            recipe_query_ref = recipe_refs.where(u'used_in_meals', u'array_contains_any', meal_ids_max_10)
            recipes = recipes + list(map(lambda doc: convert_document(doc), recipe_query_ref.stream()))

        added_meals = []

        for recipe in recipes:

            # Used to check if the recipe is already added
            if recipe['doc_id'] in added_meals:
                continue

            added_meals.append(recipe['doc_id'])

            for meal in self._specific_meals:
                if meal['meal_id'] in recipe['used_in_meals']:
                    recipe = copy.deepcopy(recipe)

                    if 'recipe' in meal:
                        meal['recipe'].append(recipe)
                    else:
                        meal['recipe'] = [recipe]

        for meal in self._specific_meals:
            if 'recipe' in meal:

                for recipe in meal['recipe']:
                    spec_recipe_refs = self.__db.document(
                        u'recipes/' + recipe['doc_id'] + '/specificRecipes/' + meal['doc_id'])

                    spec_recipe_doc = spec_recipe_refs.get()

                    if spec_recipe_doc.to_dict() is not None:
                        spec_recipe = convert_document(spec_recipe_doc)
                    else:
                        # If you create a new recipe for a meal that is already used in another camp
                        # and you did not open the recipe in the other camp, the the specific recipe
                        # does not exist in the database. We insert the default data.
                        spec_recipe = {
                            'recipe_used_for': 'all',
                            'recipe_participants': 0,  # this value is ignored if override_participants is false
                            'recipe_override_participants': False
                        }

                    for _ing in recipe['ingredients']:
                        if 'fresh' not in _ing:
                            _ing.update({'fresh': False})

                        # Escape special characters in _ing['food']
                        _ing['food'] = _ing['food'].replace('&', '\\&')

                    # filter out ingredients with empty food value
                    recipe['ingredients'] = list(filter(lambda i: i['food'] != '', recipe['ingredients']))

                    recipe['unique_id'] = meal['doc_id'] + '::' + recipe['doc_id']
                    recipe['recipe_used_for'] = spec_recipe['recipe_used_for']
                    recipe['recipe_participants'] = spec_recipe['recipe_participants']
                    recipe['recipe_override_participants'] = spec_recipe['recipe_override_participants']

        # sort meals
        self._specific_meals = sorted(self._specific_meals, key=lambda x: meal_types.index(x['meal_used_as']))
        self._specific_meals = sorted(self._specific_meals, key=lambda x: x['meal_date'])

        self._recipes_loaded = True
